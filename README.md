# plugin-pdf-viewer

**PDF viewer** for [FlickerTalk](https://flickertalk.com): read a PDF sent in a chat without
leaving the app. Tapping a PDF in a conversation opens it here (the plugin is the *viewer* of
`application/pdf`); "Open with" lists it too, and "Another app" is still one press away.

Everything happens on the phone. The plugin has **no permission and asks for none**: no network,
no sending, no storage. The bytes arrive from the app when the user taps; nothing of the document
leaves the frame.

## What it does

- Pages in a column, scrolled vertically. A page is painted on a `canvas` only when it comes
  near the screen, and let go when it moves away, so a long PDF does not exhaust a phone.
- Pinch to zoom; a double tap toggles between fit-to-width and 2×. Pages are repainted at the
  new size once the fingers lift, within a pixel budget per canvas.
- A `3 / 12` counter and a ✕ that closes the plugin.
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
test keeps `dist/` under 4 MB. The plugin is heavy (about 3 MB), so it is not a seed: the app
downloads it from the catalogue when the user turns it on. It needs FlickerTalk **1.2.0**
(`minCoreVersion`), the version that brought `views` and the tap.

Licenses of what is inside: pdf.js (Apache-2.0), with its standard fonts (Foxit, Liberation:
see `node_modules/pdfjs-dist/standard_fonts/LICENSE_*`).

## License

MIT.
