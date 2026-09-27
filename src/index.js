// A PDF viewer for FlickerTalk (document viewer, 2026-09-27): read a PDF sent in a chat without
// leaving the app. It runs inside the plugin frame's policy as it is: no worker (pdf.js works on
// the main thread), no eval, no fetch (the bytes come in `onOpen`, the standard fonts from the
// package), no wasm. It has no permission and asks for none: nothing of the document leaves.

// The legacy build carries the polyfills pdf.js needs on a WebView a year old (`Map.prototype.getOrInsertComputed`…).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as worker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { t } from "./i18n.js";

// The "fake worker": pdf.js finds the worker's code here and runs it in this thread, since the
// frame may not start a Worker (`child-src 'none'`).
globalThis.pdfjsWorker = worker;

/** How far ahead of the screen a page is painted, in screens. */
const NEAR = 1.5;
/** The most pixels one page canvas may hold: a phone's memory is not a laptop's. */
export const CANVAS_PIXELS = 16 * 1024 * 1024;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

/**
 * What a document needs from the package, without the network: the standard fonts. It is what
 * pdf.js calls a binary data factory (`fetch({kind, filename})`), served from the modules the
 * build put beside the bundle instead of from a URL.
 */
export class PackagedData {
  constructor() {
    this.standardFontDataUrl = "packaged://fonts/";
  }

  async fetch({ kind, filename }) {
    if (kind !== "standardFontDataUrl") throw new Error(`${kind} is not packaged`);
    const name = String(filename).replace(/[^A-Za-z0-9_-]/g, "");
    // The path is built at run time on purpose: the bundler must leave the import alone.
    const path = `./fonts/${name}.js`;
    const font = await import(path);
    return fromBase64(font.default);
  }
}

export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

/** The scale at which a page of `width` points fills `available` CSS pixels. */
export function fitScale(width, available) {
  return width > 0 ? Math.max(0.1, available / width) : 1;
}

/** The device pixel ratio a page may be painted at without passing the canvas budget. */
export function ratioFor(width, height, wanted = 1, budget = CANVAS_PIXELS) {
  const area = Math.max(1, width * height);
  return Math.min(wanted, Math.sqrt(budget / area));
}

/** The zoom a double tap goes to: 2× from fit, fit from anything else. */
export function toggledZoom(zoom) {
  return Math.abs(zoom - 1) < 0.05 ? 2 : 1;
}

/** Which pages are near enough the screen to be painted: `top` and `height` of the viewport,
 *  `tops` and `heights` of the pages, in the same pixels. */
export function nearPages(top, height, tops, heights) {
  const from = top - height * NEAR;
  const to = top + height * (1 + NEAR);
  const near = [];
  for (let at = 0; at < tops.length; at += 1) {
    if (tops[at] + heights[at] >= from && tops[at] <= to) near.push(at);
  }
  return near;
}

/** The page whose middle is nearest the middle of the screen: the one the counter shows. */
export function currentPage(top, height, tops, heights) {
  const middle = top + height / 2;
  let best = 0;
  let distance = Infinity;
  for (let at = 0; at < tops.length; at += 1) {
    const gap = Math.abs(tops[at] + heights[at] / 2 - middle);
    if (gap < distance) {
      distance = gap;
      best = at;
    }
  }
  return best;
}

/** Why a document could not be opened, as a state the view knows. */
export function failureOf(error) {
  if (error instanceof pdfjs.PasswordException || error?.name === "PasswordException") return "locked";
  return "broken";
}

/** Opens the bytes of a PDF with what the frame allows: no worker, no eval, no fetch, no wasm. */
export function openDocument(bytes) {
  return pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    BinaryDataFactory: PackagedData,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

const STYLE = `
:host { display: flex; flex-direction: column; font: 14px system-ui, sans-serif; color: #111; --paper: #e9e9e9; --bar: rgba(255,255,255,.92); }
:host([dark]) { color: #f4f4f4; --paper: #222; --bar: rgba(20,20,20,.92); }
* { box-sizing: border-box; }
.view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.bar { display: flex; gap: 6px; align-items: center; padding: 4px 6px; background: var(--bar); position: sticky; top: 0; z-index: 2; }
.grow { flex: 1; }
button { appearance: none; border: 0; background: transparent; color: inherit; min-width: 44px; height: 40px; border-radius: 10px; cursor: pointer; }
.i { display: block; width: 22px; height: 22px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
.count { font-variant-numeric: tabular-nums; min-width: 60px; text-align: center; }
.pages { flex: 1; overflow: auto; background: var(--paper); touch-action: pan-y; }
.sheet { position: relative; margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.sheet canvas { display: block; width: 100%; height: 100%; }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 40px 16px; text-align: center; }
.state .i { width: 48px; height: 48px; opacity: .8; }
`;

const icon = (name) => `<i class="i" style="--i:url(./icon/${name}.svg)"></i>`;

/** The viewer: the pages in a column, painted as they come near; a counter; zoom by pinch and
 *  double tap; ✕ to close. */
class PdfViewer extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.lang = "en";
    this.document = null;
    this.pages = [];
    this.zoom = 1;
    this.state = "loading";
    this.current = 0;
    this.painted = new Map();
    this.pointers = new Map();
    this.pinch = null;
    this.lastTap = 0;
    this.repaint = null;
  }

  connectedCallback() {
    this.style.height = `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;
    this.root.innerHTML = `<style>${STYLE}</style><div class="view"></div>`;
    this.view = this.root.querySelector(".view");
    this.root.addEventListener("click", (event) => this.onClick(event));
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    this.paint();
  }

  async onOpen(opening) {
    this.lang = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    if (!opening.file || !opening.file.data) {
      this.state = "broken";
      return this.paint();
    }
    try {
      this.document = await openDocument(fromBase64(opening.file.data));
      this.pages = [];
      for (let number = 1; number <= this.document.numPages; number += 1) {
        const page = await this.document.getPage(number);
        const { width, height } = page.getViewport({ scale: 1 });
        this.pages.push({ page, width, height });
      }
      this.state = "ready";
      this.paint();
      this.layout();
    } catch (error) {
      this.state = failureOf(error);
      this.paint();
    }
  }

  onClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.act === "close") globalThis.ft.close();
  }

  paint() {
    const T = (key) => t(this.lang, key);
    if (this.state !== "ready") {
      const name = this.state === "locked" ? "lock-closed-outline" : this.state === "loading" ? "time-outline" : "warning-outline";
      const text = this.state === "locked" ? T("locked") : this.state === "loading" ? T("loading") : T("broken");
      this.view.innerHTML = `
        <div class="bar"><span class="grow"></span><button data-act="close" aria-label="${escape(T("close"))}">${icon("close-outline")}</button></div>
        <div class="state" role="${this.state === "loading" ? "status" : "alert"}">${icon(name)}<p>${escape(text)}</p></div>`;
      return;
    }
    this.view.innerHTML = `
      <div class="bar">
        <span class="count" aria-label="${escape(T("page"))}" data-count>1 / ${this.pages.length}</span>
        <span class="grow"></span>
        <button data-act="close" aria-label="${escape(T("close"))}">${icon("close-outline")}</button>
      </div>
      <div class="pages" data-pages>${this.pages.map((_, at) => `<div class="sheet" data-page="${at}"></div>`).join("")}</div>`;
    const pages = this.view.querySelector("[data-pages]");
    pages.addEventListener("scroll", () => this.onScroll());
    pages.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    pages.addEventListener("pointermove", (event) => this.onPointerMove(event));
    pages.addEventListener("pointerup", (event) => this.onPointerUp(event));
    pages.addEventListener("pointercancel", (event) => this.onPointerUp(event));
  }

  /** Sizes every sheet for the zoom, then paints the ones near the screen. */
  layout() {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages) return;
    const available = Math.max(200, (pages.clientWidth || 360) - 16);
    this.sheets = [...pages.querySelectorAll(".sheet")];
    for (const [at, sheet] of this.sheets.entries()) {
      const { width, height } = this.pages[at];
      const scale = fitScale(width, available) * this.zoom;
      sheet.style.width = `${Math.round(width * scale)}px`;
      sheet.style.height = `${Math.round(height * scale)}px`;
    }
    for (const canvas of this.painted.values()) canvas.remove();
    this.painted.clear();
    this.onScroll();
  }

  onScroll() {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages || !this.sheets) return;
    const tops = this.sheets.map((sheet) => sheet.offsetTop);
    const heights = this.sheets.map((sheet) => sheet.offsetHeight);
    const top = pages.scrollTop;
    const height = pages.clientHeight || 480;
    const near = new Set(nearPages(top, height, tops, heights));
    for (const [at, canvas] of this.painted) {
      if (!near.has(at)) {
        canvas.remove();
        this.painted.delete(at);
      }
    }
    for (const at of near) if (!this.painted.has(at)) this.paintPage(at);
    const current = currentPage(top, height, tops, heights);
    if (current !== this.current) {
      this.current = current;
      const count = this.view.querySelector("[data-count]");
      if (count) count.textContent = `${current + 1} / ${this.pages.length}`;
    }
  }

  async paintPage(at) {
    const sheet = this.sheets?.[at];
    const entry = this.pages[at];
    if (!sheet || !entry) return;
    const canvas = document.createElement("canvas");
    this.painted.set(at, canvas);
    const cssWidth = sheet.clientWidth || 360;
    const scale = cssWidth / entry.width;
    const ratio = ratioFor(cssWidth, entry.height * scale, globalThis.devicePixelRatio || 1);
    const viewport = entry.page.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    sheet.append(canvas);
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      const task = entry.page.render({ canvasContext: context, viewport });
      canvas.task = task;
      await task.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") {
        // A page that will not paint stays white rather than half drawn; the reason is logged.
        console.warn("page did not paint", error);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  // ---- Zoom: two fingers, or a double tap ----

  onPointerDown(event) {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      return;
    }
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.lastTap = 0;
      this.setZoom(toggledZoom(this.zoom));
    } else {
      this.lastTap = now;
    }
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const now = Math.hypot(a.x - b.x, a.y - b.y);
      this.previewZoom(this.pinch.zoom * (now / (this.pinch.distance || 1)));
    }
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      const zoom = this.previewed ?? this.zoom;
      this.pinch = null;
      this.previewed = null;
      this.setZoom(zoom);
    }
  }

  /** While the fingers move, the sheets scale as CSS; the pixels come once they lift. */
  previewZoom(zoom) {
    this.previewed = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const pages = this.view.querySelector("[data-pages]");
    if (!pages) return;
    const available = Math.max(200, (pages.clientWidth || 360) - 16);
    for (const [at, sheet] of (this.sheets ?? []).entries()) {
      const { width, height } = this.pages[at];
      const scale = fitScale(width, available) * this.previewed;
      sheet.style.width = `${Math.round(width * scale)}px`;
      sheet.style.height = `${Math.round(height * scale)}px`;
    }
  }

  setZoom(zoom) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.layout();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-pdf-viewer")) customElements.define("ft-pdf-viewer", PdfViewer);
