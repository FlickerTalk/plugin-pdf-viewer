// The plugin's own tests (Plan §53, document viewer plan §7): the document opens from bytes
// without worker, eval, fetch or wasm; what the counter says; the states of a locked and a
// broken file; the 21 languages; and the size of what the catalogue would sign.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_PIXELS, PAGE_DELAY, currentPage, failureOf, fitScale, fromBase64, nearPages, openDocument, ratioFor, toggledZoom } from "./src/index.js";
import { HELLO, PAGE, decode, encode } from "./src/live.js";
import { LANGUAGES, catalogueOf, t } from "./src/i18n.js";

const fixture = (name) => readFileSync(join(import.meta.dirname, "test", "fixtures", name));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the arithmetic of the pages", () => {
  it("fits a page to the width, keeps a canvas within its budget and toggles the zoom", () => {
    expect(fitScale(300, 360)).toBeCloseTo(1.2);
    expect(fitScale(0, 360)).toBe(1);
    expect(ratioFor(300, 400, 3)).toBe(3);
    expect(ratioFor(4000, 4000, 3)).toBeCloseTo(Math.sqrt(CANVAS_PIXELS / 16_000_000));
    expect(toggledZoom(1)).toBe(2);
    expect(toggledZoom(2)).toBe(1);
    expect(toggledZoom(1.5)).toBe(1);
  });

  it("paints only the pages near the screen and counts the one in the middle", () => {
    const tops = [0, 1000, 2000, 3000, 4000];
    const heights = [1000, 1000, 1000, 1000, 1000];
    expect(nearPages(0, 800, tops, heights)).toEqual([0, 1, 2]);
    expect(nearPages(4200, 800, tops, heights)).toEqual([2, 3, 4]);
    expect(currentPage(0, 800, tops, heights)).toBe(0);
    expect(currentPage(1400, 800, tops, heights)).toBe(1);
    expect(currentPage(4200, 800, tops, heights)).toBe(4);
  });

  it("tells a locked document from a broken one", () => {
    expect(failureOf({ name: "PasswordException" })).toBe("locked");
    expect(failureOf(new Error("Invalid PDF structure"))).toBe("broken");
    expect(failureOf(null)).toBe("broken");
    expect(fromBase64("AQID")).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the document", () => {
  it("opens from its bytes, in this thread, with the pages it has", async () => {
    const document = await openDocument(new Uint8Array(fixture("simple.pdf")));
    expect(document.numPages).toBe(3);
    const page = await document.getPage(2);
    const { width, height } = page.getViewport({ scale: 1 });
    expect([width, height]).toEqual([300, 400]);
    const text = await page.getTextContent();
    expect(text.items.map((item) => item.str).join("")).toContain("Page two");
  });

  it("asks for a password, or says it is not a PDF", async () => {
    await expect(openDocument(new Uint8Array(fixture("locked.pdf")))).rejects.toMatchObject({ name: "PasswordException" });
    await expect(openDocument(new Uint8Array(fixture("broken.pdf")))).rejects.toMatchObject({ name: "InvalidPDFException" });
  });
});

describe("the catalogue and the package", () => {
  it("speaks the 21 languages of the app, with the same keys in each", () => {
    expect(LANGUAGES).toHaveLength(21);
    const keys = Object.keys(catalogueOf("en")).sort();
    for (const lang of LANGUAGES) expect(Object.keys(catalogueOf(lang)).sort(), lang).toEqual(keys);
    expect(t("es", "locked")).toBe("Este PDF tiene contraseña");
    expect(t("xx", "broken")).toBe("This PDF can't be opened");
  });

  it("keeps what the catalogue signs under 4 MB, fonts included", () => {
    const dist = join(import.meta.dirname, "dist");
    let total = 0;
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else total += statSync(path).size;
      }
    };
    walk(dist);
    expect(total).toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(4 * 1024 * 1024);
    expect(readdirSync(join(dist, "fonts")).length).toBeGreaterThanOrEqual(14);
  });
});

/** A fake core: it hands the file over, hears the close, carries the live channel, and keeps the
 *  plugin's memory (`ft.store`), which outlives one opening when it is passed to the next core. */
function fakeCore(memory = new Map()) {
  const handlers = [];
  const heard = [];
  return {
    heard,
    memory,
    open: (opening) => Promise.all(handlers.map((handler) => handler({ text: "", dark: false, lang: "en", file: null, ref: null, reminder: null, live: false, ...opening }))),
    hear: async (message) => {
      for (const handler of heard) await handler(encode(message));
    },
    ft: {
      onOpen: (handler) => handlers.push(handler),
      close: vi.fn(),
      live: { send: vi.fn(async () => true), onMessage: (handler) => heard.push(handler) },
      store: {
        get: vi.fn(async (key) => memory.get(key) ?? null),
        set: vi.fn(async (key, value) => (memory.set(key, value), true)),
        forget: vi.fn(async (key) => memory.delete(key)),
      },
    },
  };
}

describe("the view", () => {
  let core;
  let element;
  // In the page, not in a shadow root: Ionic's global styles do not cross a shadow boundary.
  const inside = () => element;
  const settle = async () => {
    for (let at = 0; at < 20; at += 1) await tick();
  };

  beforeEach(async () => {
    core = fakeCore();
    globalThis.ft = core.ft;
    document.body.innerHTML = "";
    element = document.createElement("ft-pdf-viewer");
    document.body.append(element);
  });

  it("shows the pages in a column with the counter, in the app's language", async () => {
    await core.open({ lang: "es", file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
    await settle();
    expect(element.state).toBe("ready");
    expect(inside().querySelectorAll(".sheet")).toHaveLength(3);
    expect(inside().querySelector("[data-count]").textContent).toBe("1 / 3");
    // The app's window has the way out.
    expect(inside().querySelector('[data-act="close"]')).toBeNull();
  });

  it("asks for an app that lends Ionic", () => {
    expect(JSON.parse(readFileSync(join(import.meta.dirname, "module.json"), "utf8")).minCoreVersion).toBe("1.6.0");
  });

  it("draws in the page: the counter in Ionic's header, the pages in a content that does not scroll", async () => {
    await core.open({ file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
    await settle();
    expect(element.shadowRoot).toBe(null);
    const count = element.querySelector(":scope > ion-header > ion-toolbar > ion-title[data-count]");
    expect(count.textContent).toBe("1 / 3");
    expect(count.getAttribute("aria-label")).toBe("Page");
    const content = element.querySelector(":scope > ion-content");
    expect(content.getAttribute("scroll-y")).toBe("false");
    expect(content.querySelectorAll("[data-pages] .sheet")).toHaveLength(3);
  });

  // Found on the phones (2026-10-09): presenting in a call, the frame fills the area above the
  // call's buttons (`<html data-fill>`), but the viewer took its height from the screen and the
  // bottom of the last page fell under the frame's edge.
  describe("its height", () => {
    const root = document.documentElement;
    afterEach(() => delete root.dataset.fill);
    const fresh = () => {
      document.body.innerHTML = "";
      element = document.createElement("ft-pdf-viewer");
      document.body.append(element);
    };
    const screenHeight = () => `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;

    it("in a frame that fills its window, is exactly the frame's height, never one from the screen", async () => {
      root.dataset.fill = "1";
      fresh();
      expect(element.style.height).toBe("100%");
      await core.open({ file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
      await settle();
      expect(element.style.height).toBe("100%");
      expect(element.style.height).not.toBe(screenHeight());
    });

    it("fills the frame even when the frame said so only when it opened the viewer", async () => {
      fresh();
      root.dataset.fill = "1";
      await core.open({ file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
      await settle();
      expect(element.style.height).toBe("100%");
    });

    it("elsewhere, keeps the height it takes from the screen", async () => {
      fresh();
      await core.open({ file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
      await settle();
      expect(element.style.height).toBe(screenHeight());
    });
  });

  it("says what is wrong in Ionic's content, with no bar of its own", async () => {
    await core.open({ file: null });
    await settle();
    expect(element.querySelector(":scope > ion-header")).toBeNull();
    expect(element.querySelector(":scope > ion-content [role=alert]").textContent).toContain("can't be opened");
  });

  // Found on the Lenovo (2026-09-28): the tap that zooms repaints, the canvas under the finger
  // goes, and its pointerup never reaches the pages. The next double tap has to work all the same.
  it("zooms back with a second double tap, even when the finger's lift was lost", async () => {
    await core.open({ file: { name: "menu.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") } });
    await settle();
    const sheet = () => inside().querySelector(".sheet");
    const fit = sheet().style.width;
    const finger = (type, pointerId) => sheet().dispatchEvent(new PointerEvent(type, { pointerId, isPrimary: true, bubbles: true, composed: true }));
    finger("pointerdown", 1);
    finger("pointerup", 1);
    finger("pointerdown", 2); // zooms; its pointerup is lost with the canvas
    expect(sheet().style.width).not.toBe(fit);
    await new Promise((resolve) => setTimeout(resolve, 350));
    finger("pointerdown", 3);
    finger("pointerup", 3);
    finger("pointerdown", 4);
    finger("pointerup", 4);
    expect(sheet().style.width).toBe(fit);
  });

  it("says when the PDF is locked, broken, or missing", async () => {
    await core.open({ file: { name: "x.pdf", mime: "application/pdf", data: fixture("locked.pdf").toString("base64") } });
    await settle();
    expect(inside().querySelector("[role=alert]").textContent).toContain("password protected");

    element = document.createElement("ft-pdf-viewer");
    document.body.append(element);
    core = fakeCore();
    globalThis.ft = core.ft;
    document.body.innerHTML = "";
    element = document.createElement("ft-pdf-viewer");
    document.body.append(element);
    await core.open({ file: { name: "x.pdf", mime: "application/pdf", data: fixture("broken.pdf").toString("base64") } });
    await settle();
    expect(inside().querySelector("[role=alert]").textContent).toContain("can't be opened");

    core = fakeCore();
    globalThis.ft = core.ft;
    document.body.innerHTML = "";
    element = document.createElement("ft-pdf-viewer");
    document.body.append(element);
    await core.open({ file: null });
    await settle();
    expect(inside().querySelector("[role=alert]").textContent).toContain("can't be opened");
  });
});

describe("the package", () => {
  // Ionic is the app's, lent to the frame: a copy in the package would be a second one, and heavy.
  it("carries no Ionic of its own", () => {
    const code = readFileSync(join(import.meta.dirname, "dist", "index.js"), "utf8");
    expect(code).not.toMatch(/@ionic\/core|ionicframework|stencil|defineCustomElement|__registerHost/i);
    expect(code).not.toMatch(/^\s*import\s.*from\s+["'](?!\.\/)/m);
  });
});

describe("the image of the Apps grid", () => {
  // icon.svg beside module.json and dist/, signed with the rest: the app draws it on the tile; the
  // Ionicon in module.json stays as the fallback (2026-10-08).
  const image = join(import.meta.dirname, "icon.svg");

  it("is a square 64 × 64 SVG of at most 4 KB at the root of the package, and not inside dist/", () => {
    expect(existsSync(image), "icon.svg").toBe(true);
    expect(statSync(image).size).toBeLessThanOrEqual(4096);
    const svg = readFileSync(image, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(existsSync(join(import.meta.dirname, "dist", "icon.svg"))).toBe(false);
  });
});

describe("a presentation in a call", () => {
  let core;
  let element;
  // In the page, not in a shadow root (Ionic's styles reach it since 1.0.2).
  const inside = () => element;
  const pdf = () => ({ name: "class.pdf", mime: "application/pdf", data: fixture("simple.pdf").toString("base64") });
  const settle = async () => {
    for (let at = 0; at < 20; at += 1) await tick();
  };
  const said = () => core.ft.live.send.mock.calls.map(([data]) => decode(data));
  // happy-dom lays nothing out: three pages of 1000 px, one under the other.
  const lay = () => {
    for (const [at, sheet] of element.sheets.entries()) {
      Object.defineProperty(sheet, "offsetTop", { value: 8 + at * 1000, configurable: true });
      Object.defineProperty(sheet, "offsetHeight", { value: 1000, configurable: true });
    }
  };
  const pages = () => inside().querySelector("[data-pages]");
  const scrollTo = (top) => {
    pages().scrollTop = top;
    pages().dispatchEvent(new Event("scroll"));
  };

  beforeEach(() => {
    core = fakeCore();
    globalThis.ft = core.ft;
    document.body.innerHTML = "";
    element = document.createElement("ft-pdf-viewer");
    document.body.append(element);
  });

  it("as the presenter, says the page it is on once the pages stop moving", async () => {
    await core.open({ live: true, presenting: "lead", file: pdf() });
    await settle();
    lay();
    vi.useFakeTimers();
    try {
      scrollTo(1400);
      vi.advanceTimersByTime(PAGE_DELAY - 1);
      expect(core.ft.live.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(said()).toEqual([{ k: PAGE, n: 2 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("as the presenter, tells a follower that just opened where it is, at once", async () => {
    await core.open({ live: true, presenting: "lead", file: pdf() });
    await settle();
    await core.hear({ k: HELLO });
    expect(said()).toEqual([{ k: PAGE, n: 1 }]);
  });

  it("as a follower, says hello on opening and goes to each page the presenter shows", async () => {
    await core.open({ live: true, presenting: "follow", file: pdf() });
    await settle();
    expect(said()).toEqual([{ k: HELLO }]);
    lay();
    await core.hear({ k: PAGE, n: 3 });
    expect(pages().scrollTop).toBe(2000);
    expect(inside().querySelector(":scope > ion-header > ion-toolbar > ion-title[data-count]").textContent).toBe("3 / 3");
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
    expect(said()).toEqual([{ k: HELLO }]);
  });

  it("keeps a page that arrives before the document is painted, and goes there once it is", async () => {
    const going = vi.spyOn(element, "goToPage");
    const opening = core.open({ live: true, presenting: "follow", file: pdf() });
    await core.hear({ k: PAGE, n: 2 });
    await opening;
    await settle();
    expect(going).toHaveBeenCalledWith(2);
  });

  it("goes no further than the first and the last page", async () => {
    await core.open({ live: true, presenting: "follow", file: pdf() });
    await settle();
    lay();
    element.goToPage(99);
    expect(pages().scrollTop).toBe(2000);
    element.goToPage(0);
    expect(pages().scrollTop).toBe(0);
  });

  it("ignores what is not a page", async () => {
    await core.open({ live: true, presenting: "follow", file: pdf() });
    await settle();
    lay();
    for (const handler of core.heard) await handler("%%%");
    await core.hear({ k: PAGE, n: "2" });
    expect(pages().scrollTop).toBe(0);
  });

  describe("after the presenter's viewer is closed and opened again (the call screen left and back)", () => {
    // happy-dom lays nothing out, and a reopened viewer goes to its page while it opens: every
    // sheet is laid out from the start, three pages of 1000 px.
    const prototype = HTMLElement.prototype;
    const saved = {};
    /** Whether the WebView has laid the sheets out yet: until then every one is at the top. */
    let laidOut = true;
    beforeEach(() => {
      for (const name of ["offsetTop", "offsetHeight"]) saved[name] = Object.getOwnPropertyDescriptor(prototype, name);
      laidOut = true;
      const page = (sheet) => (sheet.classList?.contains("sheet") ? Number(sheet.dataset.page) : null);
      Object.defineProperty(prototype, "offsetTop", { configurable: true, get() { const at = page(this); return at === null || !laidOut ? 0 : 8 + at * 1000; } });
      Object.defineProperty(prototype, "offsetHeight", { configurable: true, get() { return page(this) === null ? 0 : 1000; } });
    });
    afterEach(() => {
      for (const [name, descriptor] of Object.entries(saved)) Object.defineProperty(prototype, name, descriptor);
    });

    /** The same viewer opened again, as the app does on return: a new element, the same memory. */
    const reopen = async (opening) => {
      core = fakeCore(core.memory);
      globalThis.ft = core.ft;
      document.body.innerHTML = "";
      element = document.createElement("ft-pdf-viewer");
      document.body.append(element);
      const going = vi.spyOn(element, "goToPage");
      await core.open(opening);
      await settle();
      return going;
    };

    it("goes back to the page it was on before saying anything, then says that page", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      expect(said()).toEqual([{ k: PAGE, n: 3 }]);

      const going = await reopen({ live: true, presenting: "lead", file: pdf() });
      expect(going).toHaveBeenCalledWith(3);
      expect(said()).toEqual([{ k: PAGE, n: 3 }]);
      expect(going.mock.invocationCallOrder[0]).toBeLessThan(core.ft.live.send.mock.invocationCallOrder[0]);
      expect(pages().scrollTop).toBe(2000);
      expect(inside().querySelector("[data-count]").textContent).toBe("3 / 3");
      // A follower that opens again later hears the same page, not the first one.
      await core.hear({ k: HELLO });
      expect(said()).toEqual([{ k: PAGE, n: 3 }, { k: PAGE, n: 3 }]);
    });

    // Found on the Lenovo (2026-10-09): reopened at page 3, the presenter said and kept page 1,
    // because the WebView had not laid the pages out yet when it jumped, and the page it said was
    // read from where the pages were (still the top).
    it("says and keeps the page it was on even when the pages are still at the top, and lands there once they are laid out", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      const kept = core.memory.get("present");
      expect(JSON.parse(kept).page).toBe(3);

      // Not laid out yet: every sheet is at the top, so the jump leaves the pages where they are.
      laidOut = false;
      await reopen({ live: true, presenting: "lead", file: pdf() });
      expect(said()).toEqual([{ k: PAGE, n: 3 }]);
      // The pages report the first page meanwhile; nothing says or keeps it.
      scrollTo(0);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      await core.hear({ k: HELLO });
      expect(said()).toEqual([{ k: PAGE, n: 3 }, { k: PAGE, n: 3 }]);
      expect(core.memory.get("present")).toBe(kept);

      // Laid out: the viewer goes to its page by itself.
      laidOut = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pages().scrollTop).toBe(2000);
      expect(inside().querySelector("[data-count]").textContent).toBe("3 / 3");
      expect(core.memory.get("present")).toBe(kept);

      // From then on the presenter's own moves are said and kept as before.
      pages().dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, isPrimary: true }));
      scrollTo(1000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      expect(said().at(-1)).toEqual({ k: PAGE, n: 2 });
      expect(JSON.parse(core.memory.get("present")).page).toBe(2);
    });

    it("once the presenter touches the pages, says where they are, not the page it was going to", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));

      laidOut = false;
      await reopen({ live: true, presenting: "lead", file: pdf() });
      pages().dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, isPrimary: true }));
      laidOut = true;
      scrollTo(1000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      expect(said().at(-1)).toEqual({ k: PAGE, n: 2 });
      expect(pages().scrollTop).toBe(1000);
    });

    // The app hides the frame before it closes it (the call screen left): a frame with no height
    // may report its pages at the top, and that must not become the page the presenter keeps.
    it("says and keeps nothing while its frame is hidden", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      const kept = core.memory.get("present");

      const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
      Object.defineProperty(window, "innerHeight", { value: 0, configurable: true });
      try {
        scrollTo(0);
        await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
      } finally {
        if (height) Object.defineProperty(window, "innerHeight", height);
        else delete window.innerHeight;
      }
      expect(said()).toEqual([{ k: PAGE, n: 3 }]);
      expect(core.memory.get("present")).toBe(kept);
    });

    it("opens a document it never presented at the first page, and says nothing until it moves", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));

      const other = { ...pdf(), name: "another.pdf" };
      const going = await reopen({ live: true, presenting: "lead", file: other });
      expect(going).not.toHaveBeenCalled();
      expect(pages().scrollTop).toBe(0);
      expect(core.ft.live.send).not.toHaveBeenCalled();
    });

    it("leaves a follower to the presenter: it neither keeps nor restores a page of its own", async () => {
      await core.open({ live: true, presenting: "lead", file: pdf() });
      await settle();
      scrollTo(2000);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));

      const going = await reopen({ live: true, presenting: "follow", file: pdf() });
      expect(going).not.toHaveBeenCalled();
      expect(said()).toEqual([{ k: HELLO }]);
      await core.hear({ k: PAGE, n: 2 });
      expect(core.ft.store.set).not.toHaveBeenCalled();
    });
  });

  it("says nothing on the live channel outside a presentation", async () => {
    await core.open({ live: true, file: pdf() });
    await settle();
    lay();
    await core.hear({ k: HELLO });
    scrollTo(1400);
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY + 50));
    expect(core.ft.live.send).not.toHaveBeenCalled();
  });
});

describe("the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "module.json"), "utf8"));
  const APP_LANGUAGES = ["es", "pt", "fr", "de", "it", "ro", "ru", "uk", "pl", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];

  it("asks to talk to its twin, needs the core that presents, and speaks the app's languages", () => {
    expect(manifest.version).toBe("1.1.2");
    expect(manifest.minCoreVersion).toBe("1.6.0");
    expect(manifest.permissions).toEqual({ live: true });
    expect(Object.keys(manifest.locales)).toEqual(APP_LANGUAGES);
    for (const lang of APP_LANGUAGES) {
      const { name, summary, ...rest } = manifest.locales[lang];
      expect(rest, lang).toEqual({});
      expect(name.trim(), lang).not.toBe("");
      expect([...name].length, lang).toBeLessThanOrEqual(64);
      expect(summary.trim(), lang).not.toBe("");
      expect([...summary].length, lang).toBeLessThanOrEqual(200);
    }
  });
});
