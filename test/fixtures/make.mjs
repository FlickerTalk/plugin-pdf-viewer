// Makes the PDFs the tests use, by hand and small: `node test/fixtures/make.mjs`. Three pages
// of text in a standard font (Helvetica: the viewer must find it in the package), one that is
// not a PDF, and one that asks for a password (an /Encrypt dictionary whose keys match nothing).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A PDF from its objects, with a correct xref table. */
function pdf(objects, trailerExtra = "") {
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach((body, at) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${at + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function page(number, contentsRef) {
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents ${contentsRef} 0 R >>`;
}

function contents(text) {
  const stream = `BT /F1 24 Tf 40 340 Td (${text}) Tj ET\n0 0 1 rg 40 40 220 200 re f\n`;
  return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
}

// 1 catalog, 2 pages, 3 page A, 4 page B, 5 font, 6 content A, 7 content B, 8 page C, 9 content C
const simple = pdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R 8 0 R] /Count 3 >>",
  page(1, 6),
  page(2, 7),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  contents("Page one"),
  contents("Page two"),
  page(3, 9),
  contents("Page three"),
]);
writeFileSync(join(here, "simple.pdf"), simple);

writeFileSync(join(here, "broken.pdf"), Buffer.from("this is not a pdf at all, just some text that pretends to be one\n"));

// Standard security handler, revision 2, with owner and user entries that no password matches.
const locked = pdf(
  [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    page(1, 4),
    contents("Secret"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> >>`,
  ],
  "/Encrypt 6 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] ",
);
writeFileSync(join(here, "locked.pdf"), locked);
console.log("fixtures written");
