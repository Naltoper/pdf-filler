/** Compare live JS detectPdf against a reference jobs/<job>/zones/zones.json
 * (IoU ≥ 0.5). Useful after detector changes. Needs vendor/ (see cli.js).
 */
const fs = require("fs");
const path = require("path");
const pdfjsLib = require("./vendor/pdf.min.js");
const Prepare = require("./prepare.js");

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve(__dirname, "vendor/pdf.worker.min.js");

function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]) + Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

function match(py, js) {
  const used = new Set();
  let hit = 0;
  const misses = [];
  for (const z of py) {
    let best = -1, bi = -1;
    js.forEach((o, i) => {
      if (used.has(i) || o.page !== z.page || o.kind !== z.kind) return;
      const v = iou(z.rect, o.rect);
      if (v > best) { best = v; bi = i; }
    });
    if (best >= 0.5) { used.add(bi); hit++; }
    else misses.push({id: z.id, shape: z.shape, kind: z.kind, page: z.page, rect: z.rect, best: best.toFixed(2), ctx: z.ctx && (z.ctx.left || z.ctx.row || z.ctx.col || "")});
  }
  const extras = js.filter((_, i) => !used.has(i));
  return {hit, misses, extras};
}

(async () => {
  const jobs = process.argv.slice(2);
  const list = jobs.length ? jobs : ["fo61", "qafo069", "ncsur12", "appart", "ars"];
  for (const job of list) {
    const form = path.resolve(__dirname, "../jobs", job, "form.pdf");
    const py = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../jobs", job, "zones/zones.json"), "utf8"));
    const bytes = new Uint8Array(fs.readFileSync(form));
    const js = await Prepare.detectPdf(bytes, pdfjsLib);
    for (let i = 0; i < js.zones.length; i++) js.zones[i].id = "Z" + (i + 1);
    const m = match(py.zones, js.zones);
    const shapes = {};
    js.zones.forEach(z => { shapes[z.shape] = (shapes[z.shape] || 0) + 1; });
    console.log(`\n${job}: ref ${py.zones.length}  js ${js.zones.length}  recall ${m.hit}/${py.zones.length} (${(100 * m.hit / py.zones.length).toFixed(1)}%)  extra ${m.extras.length}`);
    console.log("  js shapes", shapes);
    const byShape = {};
    m.misses.forEach(z => { byShape[z.shape] = (byShape[z.shape] || 0) + 1; });
    console.log("  misses", byShape);
    m.misses.slice(0, 8).forEach(z => console.log("   -", z.id, z.shape, "p" + z.page, JSON.stringify(z.rect), z.ctx));
    m.extras.slice(0, 6).forEach(z => console.log("   +", z.shape, z.kind, "p" + z.page, JSON.stringify(z.rect.map(n => Math.round(n * 100) / 100)), (z.ctx && (z.ctx.left || z.ctx.above || "")).slice(0, 60)));
  }
})().catch(err => { console.error(err); process.exit(1); });
