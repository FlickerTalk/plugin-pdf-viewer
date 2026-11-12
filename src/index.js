// the legacy build has the polyfills pdf.js needs on older WebViews (Map.prototype.getOrInsertComputed…)
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as worker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { t } from "./i18n.js";
import { HELLO, PAGE, decode, encode } from "./live.js";

// pdf.js finds the worker here and runs it on this thread, the frame has child-src 'none'
globalThis.pdfjsWorker = worker;

// screens
const NEAR = 1.5;
export const CANVAS_PIXELS = 16 * 1024 * 1024;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const PAGE_DELAY = 300;
// a single key, the core keeps at most 64 keys per plugin
export const PRESENTED = "present";
export const JUMP_TIME = 2000;
export const PDF = "application/pdf";

export function documentKey(file, bytes) {
  return `${bytes.length}:${String(file?.name ?? "")}`;
}

export function rememberedPage(value, document) {
  try {
    const memory = JSON.parse(value);
    return memory?.doc === document && Number.isInteger(memory.page) && memory.page >= 1 ? memory.page : 0;
  } catch {
    return 0;
  }
}

export class PackagedData {
  constructor() {
    this.standardFontDataUrl = "packaged://fonts/";
  }

  async fetch({ kind, filename }) {
    if (kind !== "standardFontDataUrl") throw new Error(`${kind} is not packaged`);
    const name = String(filename).replace(/[^A-Za-z0-9_-]/g, "");
    // built at run time so esbuild leaves this import alone
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

export function fitScale(width, available) {
  return width > 0 ? Math.max(0.1, available / width) : 1;
}

export function ratioFor(width, height, wanted = 1, budget = CANVAS_PIXELS) {
  const area = Math.max(1, width * height);
  return Math.min(wanted, Math.sqrt(budget / area));
}

export function toggledZoom(zoom) {
  return Math.abs(zoom - 1) < 0.05 ? 2 : 1;
}

export function nearPages(top, height, tops, heights) {
  const from = top - height * NEAR;
  const to = top + height * (1 + NEAR);
  const near = [];
  for (let at = 0; at < tops.length; at += 1) {
    if (tops[at] + heights[at] >= from && tops[at] <= to) near.push(at);
  }
  return near;
}

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

export function failureOf(error) {
  if (error instanceof pdfjs.PasswordException || error?.name === "PasswordException") return "locked";
  return "broken";
}

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
ft-pdf-viewer .state > div { display: flex; flex-direction: column; align-items: center; gap: 12px; }
ft-pdf-viewer .state ion-button .i { width: 20px; height: 20px; margin: 0; margin-inline-end: 8px; opacity: 1; }
`;

const icon = (name, slot = "") => `<i class="i"${slot ? ` slot="${slot}"` : ""} style="--i:url(./icon/${name}.svg)" aria-hidden="true"></i>`;

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
    this.target = 0;
    this.jumpUntil = 0;
    this.canPick = false;
  }

  connectedCallback() {
    this.fit();
    // no shadow root, Ionic's global styles don't cross it
    this.view = this;
    this.addEventListener("click", (event) => {
      if (event.target.closest?.('[data-act="pick"]')) void this.pick();
    });
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    globalThis.ft?.live?.onMessage?.((data) => this.onLive(data));
    this.paint();
  }

  // the app sets <html data-fill> only when it opens the viewer
  fit() {
    const filled = globalThis.document?.documentElement?.dataset?.fill !== undefined;
    this.style.height = filled ? "100%" : `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;
  }

  async onOpen(opening) {
    this.fit();
    this.lang = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    const role = opening.presenting;
    this.presenting = opening.live && (role === "lead" || role === "follow") ? role : null;
    if (this.presenting === "follow") void globalThis.ft.live.send(encode({ k: HELLO }));
    const handed = Boolean(opening.file?.data);
    this.canPick = !handed && !this.presenting;
    if (!handed) {
      this.state = this.canPick ? "empty" : "broken";
      return this.paint();
    }
    await this.load(opening.file);
  }

  async pick() {
    const file = await globalThis.ft.pickFile(PDF);
    if (!file?.data) return;
    this.state = "loading";
    this.paint();
    await this.load(file);
  }

  async load(file) {
    try {
      const bytes = fromBase64(file.data);
      // read before the pages are ready, or page 1 gets said in the meantime
      const resumed = this.presenting === "lead" ? this.remembered(documentKey(file, bytes)) : Promise.resolve(0);
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
        this.jumpTo(page);
        this.sayPage();
      }
      if (this.wanted) {
        const page = this.wanted;
        this.wanted = 0;
        this.jumpTo(page);
      }
    } catch (error) {
      this.state = failureOf(error);
      this.paint();
    }
  }

  paint() {
    const T = (key) => t(this.lang, key);
    if (this.state !== "ready") {
      const pick = this.canPick && this.state !== "loading"
        ? `<ion-button data-act="pick">${icon("folder-open-outline", "start")}${escape(T("pick"))}</ion-button>`
        : "";
      if (this.state === "empty") {
        this.view.innerHTML = `<style>${STYLE}</style>
          <ion-content><div class="view">
          <div class="state">${icon("document-text-outline")}<p>${escape(T("empty"))}</p>${pick}</div>
          </div></ion-content>`;
        return;
      }
      const name = this.state === "locked" ? "lock-closed-outline" : this.state === "loading" ? "time-outline" : "warning-outline";
      const text = this.state === "locked" ? T("locked") : this.state === "loading" ? T("loading") : T("broken");
      this.view.innerHTML = `<style>${STYLE}</style>
        <ion-content><div class="view">
        <div class="state"><div role="${this.state === "loading" ? "status" : "alert"}">${icon(name)}<p>${escape(text)}</p></div>${pick}</div>
        </div></ion-content>`;
      return;
    }
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
    pages.addEventListener("wheel", () => (this.target = 0), { passive: true });
    pages.addEventListener("pointermove", (event) => this.onPointerMove(event));
    pages.addEventListener("pointerup", (event) => this.onPointerUp(event));
    pages.addEventListener("pointercancel", (event) => this.onPointerUp(event));
  }

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
    // the app hides the frame before closing it, and a 0-height frame has no page on screen
    if (globalThis.innerHeight === 0) return;
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
    if (this.target && current + 1 === this.target) this.target = 0;
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
        console.warn("page did not paint", error);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  onPointerDown(event) {
    // a pointerup can get lost when the canvas under the finger is repainted, so start over here
    if (event.isPrimary) this.pointers.clear();
    this.target = 0;
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

  async remembered(key) {
    this.documentKey = key;
    try {
      return rememberedPage(await globalThis.ft?.store?.get?.(PRESENTED), key);
    } catch {
      return 0;
    }
  }

  keepPage(page) {
    if (!this.documentKey || page === this.keptPage) return;
    this.keptPage = page;
    globalThis.ft?.store?.set?.(PRESENTED, JSON.stringify({ doc: this.documentKey, page }))?.catch?.(() => {});
  }

  pageChanged() {
    if (this.presenting !== "lead") return;
    clearTimeout(this.pageTimer);
    this.pageTimer = setTimeout(() => this.sayPage(), PAGE_DELAY);
  }

  sayPage() {
    clearTimeout(this.pageTimer);
    this.pageTimer = null;
    if (this.presenting !== "lead" || this.state !== "ready") return;
    const page = this.target || this.current + 1;
    void globalThis.ft.live.send(encode({ k: PAGE, n: page }));
    this.keepPage(page);
  }

  onLive(data) {
    const message = decode(data);
    if (!message || !this.presenting) return;
    if (message.k === HELLO && this.presenting === "lead") return this.sayPage();
    if (message.k !== PAGE || this.presenting !== "follow") return;
    if (this.state === "ready" && this.sheets?.length) this.jumpTo(message.n);
    else this.wanted = message.n;
  }

  /** The WebView may not have laid the pages out yet, hence the retry each frame for JUMP_TIME. */
  jumpTo(n) {
    const last = this.sheets?.length ?? 0;
    if (!last) return;
    this.target = Math.min(last, Math.max(1, Math.round(n)));
    this.jumpUntil = Date.now() + JUMP_TIME;
    this.goToPage(this.target);
    this.landing();
  }

  landing() {
    if (!this.target || Date.now() > this.jumpUntil) return;
    requestAnimationFrame(() => {
      if (!this.target || !this.isConnected) return;
      this.goToPage(this.target);
      this.landing();
    });
  }

  goToPage(n) {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages || !this.sheets?.length) return;
    const at = Math.min(this.sheets.length, Math.max(1, Math.round(n))) - 1;
    pages.scrollTop = this.sheets[at].offsetTop - this.sheets[0].offsetTop;
    this.onScroll();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-pdf-viewer")) customElements.define("ft-pdf-viewer", PdfViewer);
