#!/usr/bin/env node
/**
 * Node CLI for prepare / run / validate (replaces `python -m formfill`).
 *
 * Usage (from repo root):
 *   node apps-script-test/cli.js prepare jobs/<name>
 *   node apps-script-test/cli.js run jobs/<name>
 *   node apps-script-test/cli.js validate jobs/<name>
 *
 * Options: --answers PATH (default JOB/answers.json)
 *
 * Requires apps-script-test/vendor/{pdf.min.js,pdf.worker.min.js,pdf-lib.min.js}
 * (gitignored). Download once:
 *   mkdir -p apps-script-test/vendor
 *   curl -fsSL -o apps-script-test/vendor/pdf.min.js \
 *     https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
 *   curl -fsSL -o apps-script-test/vendor/pdf.worker.min.js \
 *     https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
 *   curl -fsSL -o apps-script-test/vendor/pdf-lib.min.js \
 *     https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const vendor = path.join(__dirname, "vendor");

function needVendor() {
  const files = ["pdf.min.js", "pdf.worker.min.js", "pdf-lib.min.js"];
  const missing = files.filter((f) => !fs.existsSync(path.join(vendor, f)));
  if (missing.length) {
    console.error("Missing vendor libs: " + missing.join(", "));
    console.error("See header comment in apps-script-test/cli.js for download commands.");
    process.exit(1);
  }
}

function findForm(jobDir) {
  const named = path.join(jobDir, "form.pdf");
  if (fs.existsSync(named)) return named;
  const pdfs = fs.readdirSync(jobDir).filter((n) => n.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 1) return path.join(jobDir, pdfs[0]);
  throw new Error("expected form.pdf (or a single .pdf) in " + jobDir);
}

function parseArgs(argv) {
  const args = { command: null, job: null, answers: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--answers") args.answers = argv[++i];
    else rest.push(a);
  }
  args.command = rest[0];
  args.job = rest[1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || !args.job || !["prepare", "run", "validate"].includes(args.command)) {
    console.error("Usage: node apps-script-test/cli.js <prepare|run|validate> JOB_DIR [--answers PATH]");
    process.exit(2);
  }
  needVendor();
  const pdfjsLib = require("./vendor/pdf.min.js");
  const PDFLib = require("./vendor/pdf-lib.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(vendor, "pdf.worker.min.js");
  const Prepare = require("./prepare.js");
  const Run = require("./run.js");

  const jobDir = path.resolve(root, args.job);
  if (!fs.existsSync(jobDir)) {
    console.error("job dir not found: " + jobDir);
    process.exit(1);
  }
  const formPath = findForm(jobDir);
  const formBytes = new Uint8Array(fs.readFileSync(formPath));
  const answersPath = path.resolve(args.answers || path.join(jobDir, "answers.json"));

  if (args.command === "prepare") {
    const res = await Prepare.prepare(formBytes, path.basename(formPath), pdfjsLib, PDFLib);
    const zdir = path.join(jobDir, "zones");
    fs.mkdirSync(zdir, { recursive: true });
    fs.writeFileSync(path.join(zdir, "zones.json"), JSON.stringify(res.zmap, null, 2));
    fs.writeFileSync(path.join(zdir, "zones.txt"), res.txt);
    if (res.pdf) fs.writeFileSync(path.join(zdir, "zones.pdf"), Buffer.from(res.pdf));
    const kinds = { check: 0, text: 0, any: 0 };
    res.zmap.zones.forEach((z) => { kinds[z.kind] = (kinds[z.kind] || 0) + 1; });
    console.log("form: " + path.basename(formPath) + " (" + res.zmap.kind + ")");
    console.log(res.zmap.zones.length + " zones: " + kinds.check + " check, " + kinds.text + " text, " +
      kinds.any + " any — map " + res.zmap.map_id);
    (res.zmap.notes || []).forEach((n) => console.log("  note: " + n));
    console.log("-> for the gem: " + path.join(zdir, "zones.pdf") + ", " + path.join(zdir, "zones.txt"));
    return;
  }

  const zmapPath = path.join(jobDir, "zones", "zones.json");
  if (!fs.existsSync(zmapPath)) {
    console.error("zones/zones.json missing: run prepare first");
    process.exit(1);
  }
  if (!fs.existsSync(answersPath)) {
    console.error("answers not found: " + answersPath);
    process.exit(1);
  }
  const zmap = JSON.parse(fs.readFileSync(zmapPath, "utf8"));
  const data = JSON.parse(fs.readFileSync(answersPath, "utf8"));

  if (args.command === "validate") {
    const checked = Run.validateAnswers(data, zmap);
    (checked.warnings || []).forEach((w) => console.log("  warning: " + w));
    if (checked.errors.length) {
      const msg = Run.formatForGem(checked.errors);
      const out = path.join(jobDir, "out");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "gem_feedback.txt"), msg);
      console.log(msg);
      console.log("\n-> send to gem: " + path.join(out, "gem_feedback.txt"));
      process.exit(2);
    }
    console.log(path.basename(answersPath) + " valid (" + data.answers.length + " answers, map " + zmap.map_id + ")");
    return;
  }

  const result = await Run.run(formBytes, zmap, data, PDFLib, {});
  const out = path.join(jobDir, "out");
  fs.mkdirSync(out, { recursive: true });
  if (result.errors && result.errors.length) {
    const msg = result.feedback || Run.formatForGem(result.errors);
    fs.writeFileSync(path.join(out, "gem_feedback.txt"), msg);
    console.log(msg);
    console.log("\n-> send to gem: " + path.join(out, "gem_feedback.txt"));
    process.exit(2);
  }
  (result.warnings || []).forEach((w) => console.log("  warning: " + w));
  fs.writeFileSync(path.join(out, "plan.json"), JSON.stringify(result.plan, null, 2));
  fs.writeFileSync(path.join(out, "filled.pdf"), Buffer.from(result.filled));
  fs.writeFileSync(path.join(out, "review.pdf"), Buffer.from(result.review));
  const counts = {};
  result.plan.answers.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  console.log("answers: " + Object.keys(counts).sort().map((k) => k + "=" + counts[k]).join(", "));
  console.log("writes: " + result.plan.ops.length + "; unused text zones: " + (result.plan.unused || []).length);
  console.log("outputs: " + out + "/ (filled.pdf, review.pdf, plan.json)");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
