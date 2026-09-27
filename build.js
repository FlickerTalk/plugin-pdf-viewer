// Builds `dist/` from `src/`: one bundle with pdf.js and its worker inside (the worker runs in the
// main thread: the frame may start no Worker), and the standard fonts as small modules beside it,
// loaded only when a document needs one. The package the catalogue signs is `module.json` + `dist/`.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/fonts", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/index.js",
  legalComments: "none",
  logLevel: "info",
  // The fonts are imported by name at runtime, not bundled.
  external: ["./fonts/*"],
});

for (const file of readdirSync("node_modules/pdfjs-dist/standard_fonts")) {
  if (!file.endsWith(".pfb") && !file.endsWith(".ttf")) continue;
  const base64 = readFileSync(`node_modules/pdfjs-dist/standard_fonts/${file}`).toString("base64");
  writeFileSync(`dist/fonts/${file.replace(/[^A-Za-z0-9_-]/g, "")}.js`, `export default ${JSON.stringify(base64)};\n`);
}
