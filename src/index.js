// A PDF viewer for FlickerTalk (document viewer, 2026-09-27): read a PDF sent in a chat without
// leaving the app. It runs inside the plugin frame's policy as it is: no worker (pdf.js works on
// the main thread), no eval, no fetch (the bytes come in `onOpen`, the standard fonts from the
// package), no wasm. It asks only for `live`, used only inside a call (Plugin API 1.6.0): the
// presenter tells its twin the page it is on, never the document, which reaches the other phone as
// a file of the chat. The presenter's viewer remembers its page in its own memory (`ft.store`):
// the app closes it when the call screen is left, and on return it opens where it was.

// The legacy build carries the polyfills pdf.js needs on a WebView a year old (`Map.prototype.getOrInsertComputed`…).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as worker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { t } from "./i18n.js";
import { HELLO, PAGE, decode, encode } from "./live.js";

// The "fake worker": pdf.js finds the worker's code here and runs it in this thread, since the
// frame may not start a Worker (`child-src 'none'`).
globalThis.pdfjsWorker = worker;

/** How far ahead of the screen a page is painted, in screens. */
const NEAR = 1.5;
/** The most pixels one page canvas may hold: a phone's memory is not a laptop's. */
export const CANVAS_PIXELS = 16 * 1024 * 1024;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
/** How long the presenter's pages must rest before the page is said: a fling says one page. */
export const PAGE_DELAY = 300;
/** The one key of the presenter's memory: the last document it presented and its page. One key,
 *  not one per document, because the core keeps at most 64 short keys for a plugin. */
export const PRESENTED = "present";

/** Which document is presented, as the presenter remembers it: its name and its size. */
export function documentKey(file, bytes) {
  return `${bytes.length}:${String(file?.name ?? "")}`;
}

/** The page the presenter was on in `document`, from its memory; 0 when it never presented it. */
export function rememberedPage(value, document) {
  try {
    const memory = JSON.parse(value);
    return memory?.doc === document && Number.isInteger(memory.page) && memory.page >= 1 ? memory.page : 0;
  } catch {
    return 0;
  }
}

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

// Ionic draws the window (the app lends it to the frame, app 1.6.0): the header with the counter
// and the content. This is only what is the viewer's own: the pages.
const STYLE = `
ft-pdf-viewer { display: flex; flex-direction: column; font: 14px system-ui, sans-serif; color: var(--ion-text-color, #111); --paper: #e9e9e9; }
ft-pdf-viewer[dark] { color: var(--ion-text-color, #f4f4f4); --paper: #222; }
ft-pdf-viewer * { box-sizing: border-box; }
ft-pdf-viewer ion-content { flex: 1; }
ft-pdf-viewer .view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
ft-pdf-viewer .i { display: block; width: 22px; height: 22px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
ft-pdf-viewer .count { font-variant-numeric: tabular-nums; }
ft-pdf-viewer .pages { flex: 1; overflow: auto; background: var(--paper); touch-action: pan-y; }
ft-pdf-viewer .sheet { position: relative; margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
ft-pdf-viewer .sheet canvas { display: block; width: 100%; height: 100%; }
ft-pdf-viewer .state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 40px 16px; text-align: center; }
ft-pdf-viewer .state .i { width: 48px; height: 48px; opacity: .8; }
`;

const icon = (name) => `<i class="i" style="--i:url(./icon/${name}.svg)" aria-hidden="true"></i>`;

/** The viewer: the pages in a column, painted as they come near; a counter; zoom by pinch and
 *  double tap. The way out is the app's window. */
class PdfViewer extends HTMLElement {
  constructor() {
    super();
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
    this.presenting = null;
    this.wanted = 0;
    this.pageTimer = null;
    this.documentKey = null;
    this.keptPage = 0;
  }

  connectedCallback() {
    this.style.height = `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;
    // In the page, not in a shadow root: the frame holds only this viewer, and Ionic's global
    // styles do not cross a shadow boundary. Each screen is its own header and content.
    this.view = this;
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    globalThis.ft?.live?.onMessage?.((data) => this.onLive(data));
    this.paint();
  }

  async onOpen(opening) {
    this.lang = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    // Opened by the app in a call (1.6.0), with the live channel: lead or follow the presenter.
    const role = opening.presenting;
    this.presenting = opening.live && (role === "lead" || role === "follow") ? role : null;
    if (this.presenting === "follow") void globalThis.ft.live.send(encode({ k: HELLO }));
    if (!opening.file || !opening.file.data) {
      this.state = "broken";
      return this.paint();
    }
    try {
      const bytes = fromBase64(opening.file.data);
      // The presenter opened again (the call screen left and back): where it was, read before the
      // pages are ready so that nothing is said from the first page meanwhile.
      const resumed = this.presenting === "lead" ? this.remembered(documentKey(opening.file, bytes)) : Promise.resolve(0);
      this.document = await openDocument(bytes);
      this.pages = [];
      for (let number = 1; number <= this.document.numPages; number += 1) {
        const page = await this.document.getPage(number);
        const { width, height } = page.getViewport({ scale: 1 });
        this.pages.push({ page, width, height });
      }
      const page = await resumed;
      this.state = "ready";
      this.paint();
      this.layout();
      if (page) {
        this.keptPage = page;
        this.goToPage(page);
        this.sayPage();
      }
      if (this.wanted) {
        const page = this.wanted;
        this.wanted = 0;
        this.goToPage(page);
      }
    } catch (error) {
      this.state = failureOf(error);
      this.paint();
    }
  }

  paint() {
    const T = (key) => t(this.lang, key);
    if (this.state !== "ready") {
      const name = this.state === "locked" ? "lock-closed-outline" : this.state === "loading" ? "time-outline" : "warning-outline";
      const text = this.state === "locked" ? T("locked") : this.state === "loading" ? T("loading") : T("broken");
      this.view.innerHTML = `<style>${STYLE}</style>
        <ion-content><div class="view">
        <div class="state" role="${this.state === "loading" ? "status" : "alert"}">${icon(name)}<p>${escape(text)}</p></div>
        </div></ion-content>`;
      return;
    }
    // The pages scroll and zoom in their own box: the content does not scroll.
    this.view.innerHTML = `<style>${STYLE}</style>
      <ion-header><ion-toolbar>
        <ion-title class="count" aria-label="${escape(T("page"))}" data-count>1 / ${this.pages.length}</ion-title>
      </ion-toolbar></ion-header>
      <ion-content scroll-y="false"><div class="view">
      <div class="pages" data-pages>${this.pages.map((_, at) => `<div class="sheet" data-page="${at}"></div>`).join("")}</div>
      </div></ion-content>`;
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
      this.pageChanged();
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
    // A primary pointer is the first finger down, so none is left: a lift that never arrived (its
    // canvas repainted away under the finger) must not turn the next tap into a pinch.
    if (event.isPrimary) this.pointers.clear();
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

  // ---- A presentation in a call (1.6.0) ----

  /** The presenter's page in this document from its memory, 0 if none; it now keeps this one. */
  async remembered(key) {
    this.documentKey = key;
    try {
      return rememberedPage(await globalThis.ft?.store?.get?.(PRESENTED), key);
    } catch {
      return 0;
    }
  }

  /** The presenter keeps the page it said, so that it opens there again. */
  keepPage(page) {
    if (!this.documentKey || page === this.keptPage) return;
    this.keptPage = page;
    globalThis.ft?.store?.set?.(PRESENTED, JSON.stringify({ doc: this.documentKey, page }))?.catch?.(() => {});
  }

  /** The presenter's page moved: said once it rests for PAGE_DELAY. */
  pageChanged() {
    if (this.presenting !== "lead") return;
    clearTimeout(this.pageTimer);
    this.pageTimer = setTimeout(() => this.sayPage(), PAGE_DELAY);
  }

  sayPage() {
    clearTimeout(this.pageTimer);
    this.pageTimer = null;
    if (this.presenting !== "lead" || this.state !== "ready") return;
    void globalThis.ft.live.send(encode({ k: PAGE, n: this.current + 1 }));
    this.keepPage(this.current + 1);
  }

  /** What the twin said: a follower's hello (lead), or the presenter's page (follow). */
  onLive(data) {
    const message = decode(data);
    if (!message || !this.presenting) return;
    if (message.k === HELLO && this.presenting === "lead") return this.sayPage();
    if (message.k !== PAGE || this.presenting !== "follow") return;
    if (this.state === "ready" && this.sheets?.length) this.goToPage(message.n);
    else this.wanted = message.n;
  }

  /** Puts page `n` (from 1) at the top of the screen; past either end, the first or the last. */
  goToPage(n) {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages || !this.sheets?.length) return;
    const at = Math.min(this.sheets.length, Math.max(1, Math.round(n))) - 1;
    pages.scrollTop = this.sheets[at].offsetTop - this.sheets[0].offsetTop;
    this.onScroll();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-pdf-viewer")) customElements.define("ft-pdf-viewer", PdfViewer);
