# plugin-pdf-viewer

**PDF viewer** for [FlickerTalk](https://flickertalk.com): read a PDF sent in a chat without
leaving the app. Tapping a PDF in a conversation opens it here (the plugin is the *viewer* of
`application/pdf`); "Open with" lists it too, and "Another app" is still one press away.

Everything happens on the phone. The plugin asks for one permission, **`live`**, and uses it only
when the app opens it inside a call to present (FlickerTalk 1.6.0): the presenter's viewer tells
the other phone the page number it is on, and the other one follows. The document itself reaches
the other phone as a normal file of the chat; no network and no sending. The only thing it keeps
is the presenter's place (the document's name and size, and its page) in its own plugin memory.

## What it does

- Pages in a column, scrolled vertically. A page is painted on a `canvas` only when it comes
  near the screen, and let go when it moves away, so a long PDF does not exhaust a phone.
- Pinch to zoom; a double tap toggles between fit-to-width and 2×. Pages are repainted at the
  new size once the fingers lift, within a pixel budget per canvas.
- A `3 / 12` counter; the way out is the app's window.
- In a call (FlickerTalk 1.6.0), the app can open it to present: the presenter's viewer says the
  page it is on once its pages stop moving, and the other phone's viewer follows that page (its
  counter too). Opened outside a presentation, it says nothing on the live channel.
- The presenter keeps its place: leaving the call screen closes the viewer, and when the presenter
  comes back it opens the same document at the page it was on and tells the other phone that page,
  instead of starting again at the first one (1.1.1).
- Errors, with an icon and a text in the app's language: a broken file or none ("This PDF can't
  be opened") and a password-protected one ("This PDF is password protected").
- Links inside the PDF are not followed. Dark mode follows the app.

## pdf.js inside the plugins' policy

The frame's policy (`default-src 'none'`, no workers, no `eval`, no `fetch`, no wasm) is not
relaxed for this plugin. pdf.js runs with:

- **no worker**: the worker's code is bundled and left in `globalThis.pdfjsWorker`, so pdf.js
  runs it in the main thread (its "fake worker");
- **no eval**: `isEvalSupported: false`;
- **no fetch**: the bytes come in `onOpen` (`file.data`), and the standard fonts come from the
  package (`dist/fonts/*.js`, loaded by `import()` only when a document needs one) through a
  binary data factory of our own;
- **no wasm**: `useWasm: false`.
- The **legacy** build of pdf.js, which carries the polyfills a WebView a year old needs
  (`Map.prototype.getOrInsertComputed` is not in Chromium 141).

Accepted limits: no CMaps (CJK text in old PDFs may not show), no wasm (JPEG 2000 and JBIG2
images may not show), no forms, no text selection, no search, no password prompt.

## Development

```sh
npm install
npm test          # Vitest + happy-dom, on src/ and the PDFs in test/fixtures
npm run build     # esbuild: src/ → dist/index.js + dist/fonts/*.js
node test/fixtures/make.mjs   # remakes the three test PDFs
```

`dist/` is generated and **committed**: what the catalogue signs is `module.json` + `dist/`. A
test keeps `dist/` under 4 MB. Since app 1.6.0 every plugin travels inside the app as a seed, this
one too; the catalogue only updates it. It needs FlickerTalk **1.6.0** (`minCoreVersion`), the
version that lends Ionic to the plugin frame and opens it to present in a call (`views` and the tap
came with 1.2.0): the counter sits in Ionic's `ion-header > ion-toolbar` and the pages in an
`ion-content` that does not scroll (they scroll and zoom in their own box), so it looks like the rest
of FlickerTalk. The package carries no Ionic (`@ionic/core` is only a devDependency, so the tests
draw what the phone draws).

Licenses of what is inside: pdf.js (Apache-2.0), with its standard fonts (Foxit, Liberation:
see `node_modules/pdfjs-dist/standard_fonts/LICENSE_*`).

## License

MIT.
