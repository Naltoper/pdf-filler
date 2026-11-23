/** Repair or generate answers.json so JS validate succeeds for each job.
 * Usage: node apps-script-test/repair-answers.js [job...]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Run = require("./run.js");

const root = path.resolve(__dirname, "..");

function labelOf(z) {
  const c = z.ctx || {};
  return (c.left || c.row || c.above || c.col || c.right || c.tooltip || z.id || "Field").slice(0, 120);
}

function choiceLabel(z) {
  const c = z.ctx || {};
  return (c.right || c.col || c.above || c.left || "Yes").slice(0, 80);
}

function exampleText(z, i) {
  if (z.cells && z.cells.length) {
    const n = z.cells.length;
    return "X".repeat(Math.min(n, 12)).slice(0, n) || "X";
  }
  if (z.choices && z.choices.length) return z.choices[0];
  const lab = labelOf(z).toLowerCase();
  if (/date|birth/.test(lab)) return "2024-01-15";
  if (/phone|tel|fax/.test(lab)) return "+33 4 42 85 85 85";
  if (/mail|e-mail|email/.test(lab)) return "example@airbus.com";
  if (/name|company|legal/.test(lab)) return "Example Company SAS";
  if (/address|street|city/.test(lab)) return "1 Example Street";
  if (/zip|post/.test(lab)) return "13000";
  if (/website|url|http/.test(lab)) return "https://www.example.com";
  return "Example value " + (i + 1);
}

function generateFromZones(zmap, meta) {
  const answers = [];
  const used = new Set();
  // Prefer one YES (or first check) per row-ish group for checkboxes: take every Nth or all with unique ids
  const checks = zmap.zones.filter((z) => z.kind === "check" && !z.checked);
  const texts = zmap.zones.filter((z) => (z.kind === "text" || z.kind === "any") && !z.prefilled);

  // Fill text/any zones (cap to keep files reasonable but still substantial)
  texts.forEach((z, i) => {
    if (used.has(z.id)) return;
    used.add(z.id);
    answers.push({
      ref: String(i + 1),
      page: z.page || null,
      label: labelOf(z),
      type: /date|birth/.test(labelOf(z).toLowerCase()) ? "date" : "text",
      zone: z.id,
      value: exampleText(z, i),
      confidence: "medium",
      note_for_reviewer: "Example value for validation / demo fill"
    });
  });

  // For checks: check at most one per (page, row-ish y rounded) preferring YES/col Yes
  const byRow = new Map();
  checks.forEach((z) => {
    const y = Math.round((z.rect[1] + z.rect[3]) / 2 / 4) * 4;
    const key = z.page + ":" + y;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(z);
  });
  let ci = 0;
  for (const group of byRow.values()) {
    let pick = group.find((z) => /^(yes|oui|ja|y)$/i.test(String((z.ctx || {}).col || "").trim()))
      || group.find((z) => /yes|oui|ja/i.test(choiceLabel(z)))
      || group[0];
    if (!pick || used.has(pick.id)) continue;
    used.add(pick.id);
    ci++;
    answers.push({
      ref: "C" + ci,
      page: pick.page || null,
      label: labelOf(pick),
      type: "choice",
      zone: pick.id,
      choice: choiceLabel(pick),
      confidence: "medium",
      note_for_reviewer: "Example checkbox for validation / demo fill"
    });
  }

  if (!answers.length) {
    const z = zmap.zones[0];
    answers.push({
      ref: "1", page: z.page || 1, label: labelOf(z), type: "text", zone: z.id,
      value: "Example", confidence: "low", note_for_reviewer: "Fallback example"
    });
  }

  return {
    form: {
      title: meta.title || "Example form",
      id: meta.id || null,
      revision: meta.revision || null,
      file_name: meta.file_name || zmap.source || "form.pdf",
      zone_map: zmap.map_id,
      pages: meta.pages || null,
      issuer: meta.issuer || null,
      respondent: meta.respondent || "EXAMPLE RESPONDENT"
    },
    answers
  };
}

function bestZone(zones, wantKind, label, payload, used) {
  let best = null, score = -1;
  for (const z of zones) {
    if (used.has(z.id)) continue;
    if (wantKind === "check" && z.kind === "text") continue;
    if (wantKind === "text" && z.kind === "check") continue;
    // any accepts both
    const around = Object.keys(z.ctx || {}).map((k) => z.ctx[k]).filter(Boolean).join(" ");
    let s = Run.similarity ? 0 : 0;
    // use exported norm/similarity if available
    const sim = Run.similarity || ((a, b) => 0);
    s = Math.max(sim(label || "", around), sim(payload || "", around), sim(label || "", (z.ctx || {}).left || ""));
    if (s > score) { score = s; best = z; }
  }
  return best && score >= 40 ? best : null;
}

function remapAnswers(data, zmap) {
  const zones = zmap.zones.slice();
  const used = new Set();
  const out = JSON.parse(JSON.stringify(data));
  out.form = out.form || {};
  out.form.zone_map = zmap.map_id;
  out.answers = (out.answers || []).map((a, i) => {
    const ans = Object.assign({}, a);
    if (ans.do_not_fill || ans.type === "signature") return ans;

    function take(kind, hintLabel, hintPayload, current) {
      if (current && zmap.zones.find((z) => z.id === current)) {
        const z = zmap.zones.find((x) => x.id === current);
        const ok = !(kind === "check" && z.kind === "text") && !(kind === "text" && z.kind === "check");
        if (ok && !used.has(current)) { used.add(current); return current; }
      }
      const z = bestZone(zones, kind, hintLabel || ans.label, hintPayload, used);
      if (z) { used.add(z.id); return z.id; }
      // fallback: first free matching kind
      const fb = zones.find((z) => !used.has(z.id) && (
        kind === "check" ? z.kind === "check" || z.kind === "any" : z.kind === "text" || z.kind === "any"
      ));
      if (fb) { used.add(fb.id); return fb.id; }
      return null;
    }

    if (ans.type === "text" || ans.type === "date") {
      ans.zone = take("text", ans.label, ans.value, ans.zone);
      if (ans.value == null && !ans.note_for_reviewer) {
        ans.note_for_reviewer = "Example empty field";
      }
      if (ans.remark) {
        ans.remark_zone = take("text", ans.label, ans.remark, ans.remark_zone);
      }
    } else if (ans.type === "choice") {
      ans.zone = take("check", ans.label, ans.choice, ans.zone);
      if (ans.remark) ans.remark_zone = take("text", ans.label, ans.remark, ans.remark_zone);
    } else if (ans.type === "multi_choice") {
      const opts = ans.options_checked || [];
      ans.zones = opts.map((opt, k) => take("check", ans.label, opt, (ans.zones || [])[k]));
      if (ans.remark) ans.remark_zone = take("text", ans.label, ans.remark, ans.remark_zone);
    }
    if (ans.inline_text) ans.inline_zone = take("text", ans.label, ans.inline_text, ans.inline_zone);
    return ans;
  });
  return out;
}

function findAnswersPath(jobDir) {
  const a = path.join(jobDir, "answers.json");
  const b = path.join(jobDir, "answer.json");
  if (fs.existsSync(a)) return a;
  if (fs.existsSync(b)) return b;
  return null;
}

function findFormName(jobDir) {
  if (fs.existsSync(path.join(jobDir, "form.pdf"))) return "form.pdf";
  const pdfs = fs.readdirSync(jobDir).filter((n) => n.toLowerCase().endsWith(".pdf"));
  return pdfs[0] || "form.pdf";
}

(async () => {
  const jobs = process.argv.slice(2);
  const list = jobs.length ? jobs : ["appart", "ars", "fo61", "ncsur12", "qafo069", "vendor"];
  for (const job of list) {
    const jobDir = path.join(root, "jobs", job);
    const zmap = JSON.parse(fs.readFileSync(path.join(jobDir, "zones", "zones.json"), "utf8"));
    const srcPath = findAnswersPath(jobDir);
    let data;
    let action;
    if (!srcPath) {
      data = generateFromZones(zmap, { title: job + " questionnaire", id: job.toUpperCase(), file_name: findFormName(jobDir) });
      action = "generated";
    } else {
      data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
      // Ensure schema basics
      if (!data.form) data.form = {};
      data.form.file_name = data.form.file_name || findFormName(jobDir);
      data.form.zone_map = zmap.map_id;
      // Fill missing zones on answers (qafo069)
      const missingZones = (data.answers || []).some((a) => {
        if (a.do_not_fill || a.type === "signature") return false;
        if (a.type === "multi_choice") return !a.zones;
        if (a.type === "choice" || a.type === "text" || a.type === "date") return !("zone" in a);
        return false;
      });
      let checked = Run.validateAnswers(data, zmap);
      if (checked.errors.length || missingZones) {
        data = remapAnswers(data, zmap);
        // still broken? regenerate
        checked = Run.validateAnswers(data, zmap);
        if (checked.errors.length) {
          console.log(job + ": remap still failing (" + checked.errors.length + "), generating fresh examples");
          const meta = Object.assign({}, data.form, { file_name: findFormName(jobDir) });
          data = generateFromZones(zmap, meta);
          action = "regenerated";
        } else {
          action = "remapped";
        }
      } else {
        action = "ok-patched-map";
      }
      // Ensure empty values have notes (warnings hygiene)
      (data.answers || []).forEach((a) => {
        if ((a.type === "text" || a.type === "date") && (a.value == null || a.value === "") && !a.note_for_reviewer && !a.do_not_fill) {
          a.note_for_reviewer = "Left empty (example)";
        }
      });
    }
    const dest = path.join(jobDir, "answers.json");
    fs.writeFileSync(dest, JSON.stringify(data, null, 2) + "\n");
    const final = Run.validateAnswers(data, zmap);
    console.log(job + ": " + action + " → " + dest + " answers=" + data.answers.length +
      " errors=" + final.errors.length + " warnings=" + final.warnings.length);
    if (final.errors.length) {
      final.errors.slice(0, 8).forEach((e) => console.log("  ERR " + e));
      process.exitCode = 1;
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
