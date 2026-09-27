// The plugin's own tests (Plan §53, document viewer plan §7): the document opens from bytes
// without worker, eval, fetch or wasm; what the counter says; the states of a locked and a
// broken file; the 21 languages; and the size of what the catalogue would sign.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_PIXELS, currentPage, failureOf, fitScale, fromBase64, nearPages, openDocument, ratioFor, toggledZoom } from "./src/index.js";
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

/** A fake core: it hands the file over and hears the close. */
function fakeCore() {
  const handlers = [];
  return {
    open: (opening) => Promise.all(handlers.map((handler) => handler({ text: "", dark: false, lang: "en", file: null, ref: null, reminder: null, live: false, ...opening }))),
    ft: { onOpen: (handler) => handlers.push(handler), close: vi.fn() },
  };
}

describe("the view", () => {
  let core;
  let element;
  const inside = () => element.shadowRoot;
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
    expect(inside().querySelector('[data-act="close"]').getAttribute("aria-label")).toBe("Cerrar");
    inside().querySelector('[data-act="close"]').click();
    expect(core.ft.close).toHaveBeenCalled();
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
