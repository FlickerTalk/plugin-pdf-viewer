# plugin-pdf-viewer

Plugin **visor de PDF** de FlickerTalk (plan del visor de documentos, 2026-09-27). Repo propio;
el paquete lo firma y publica el catálogo (`FlickerTalk/web`).

- `module.json`: `com.flickertalk.pdfviewer`, componente `ft-pdf-viewer`, **sin permisos**,
  `opens` y `views` = `application/pdf`, `minCoreVersion` 1.2.0.
- `src/index.js`: el web component y las funciones puras (encaje, presupuesto del canvas, qué
  páginas pintar, cuál cuenta, el estado del error) exportadas para los tests; `openDocument`
  abre pdf.js con lo que permite la CSP de los plugins. `src/i18n.js`: 21 idiomas.
- `build.js` (esbuild): `dist/index.js` con pdf.js **legacy** y su worker dentro, y
  `dist/fonts/*.js` (las fuentes estándar en base64, una por módulo, que se cargan con `import()`
  solo cuando un documento las pide). **`dist/` se versiona.** Tras tocar `src/`: `npm run build`.
- `test/fixtures/make.mjs` genera los tres PDF de prueba (3 páginas, roto, con contraseña).
- `npm test`: Vitest + happy-dom (sin canvas: se prueba que el documento abre, cuenta páginas y
  saca texto; el pintado se comprobó en Chromium con la CSP exacta de la app).

## Reglas

- La CSP de los plugins **no se toca**: sin worker (`globalThis.pdfjsWorker`), sin `eval`
  (`isEvalSupported: false`), sin `fetch` (bytes por `onOpen`, fuentes desde el paquete con una
  factoría propia), sin wasm (`useWasm: false`). Build legacy de pdf.js por los polyfills.
- Sin permisos: nada del documento sale del marco. Los enlaces del PDF no se siguen.
- `dist/` no pasa de 4 MB (test). No es semilla: se descarga del catálogo.
- Iconos: solo los que presta el núcleo (`./icon/<nombre>.svg`). Textos: solo del catálogo, cada
  clave nueva en los 21 idiomas en el mismo cambio (el test lo exige).
- Código y comentarios en inglés; `.md` en español (el README en inglés, como pide el plan).
