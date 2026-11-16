const fs = require("fs");
const path = require("path");
const pdfjsLib = require("./vendor/pdf.min.js");
const PDFLib = require("./vendor/pdf-lib.min.js");
const PdfTest = require("./logic.js");

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve(__dirname, "vendor/pdf.worker.min.js");

const srcPath = process.argv[2];
const outPath = process.argv[3];

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(srcPath));
  const doc = await pdfjsLib.getDocument({data: bytes.slice(0)}).promise;
  const pages = [];
  let words = 0;
  let cells = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const view = page.getViewport({scale: 1});
    const [text, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const found = PdfTest.findHelicopter(text.items);
    const rects = PdfTest.tableRectangles(ops.fnArray, ops.argsArray, pdfjsLib.OPS, view.width, view.height);
    words += found.length;
    cells += rects.length;
    pages.push({words: found, cells: rects});
    console.log(`page ${i}: helicopter=${found.length} cells=${rects.length}`);
  }
  await doc.destroy();
  const out = await PdfTest.markPdf(bytes, pages, PDFLib);
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, Buffer.from(out));
  console.log(`TOTAL helicopter=${words} cells=${cells}`);
  console.log(`wrote ${outPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
