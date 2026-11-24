/* run : valide answers.json, écrit le PDF et le review (implémentation canonique JS).
   Les rectangles des zones sont en repère page (origine en haut, y vers le bas). */
const Run = (function () {
  "use strict";

  var ROLE_FR = {value: "la valeur", choice: "la case", option: "l'option", remark: "la remarque", inline: "le texte dans la question"};
  var FIT_MIN = 55;
  var MAX_FS = 9.5, REMARK_FS = 8.0, MIN_FS = 5.0, LINE_GAP = 1.15;
  var LINE_SHAPES = {fill: 1, underline: 1, blank: 1};
  var RANGE_RE = /\d\s*(?:to|-|–|à|bis)\s*\d+\.\d/i;
  var MARKDOWN_RE = /\*\*|__|\[[^\]]*\]\([^)]*\)|^#+\s/m;
  var REDIRECT_RE = /google\.[a-z.]+\/search|\/url\?q=/i;
  var PLACEHOLDER_RE = /\[(?:draft|todo|tbd|à compléter|to be filled)[^\]]*\]/i;
  var ZONE_RE = /^Z[0-9]+$/;
  var MAP_RE = /^[0-9a-f]{8}$/;
  var STYLE = {
    ok: {title: "OK", popup: [0.08, 0.28, 0.58], fill: [0.88, 0.93, 1.0], border: 1.0},
    check: {title: "À vérifier", popup: [0.55, 0.32, 0.04], fill: [1.0, 0.95, 0.82], border: 1.2},
    error: {title: "À traiter", popup: [0.58, 0.10, 0.08], fill: [1.0, 0.90, 0.90], border: 1.4}
  };

  function pyRepr(s) {
    return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }

  function norm(s) {
    s = String(s == null ? "" : s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }

  function indel(a, b) {
    var n = a.length, m = b.length, prev = new Array(m + 1), i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      var cur = new Array(m + 1);
      cur[0] = i;
      var ai = a.charCodeAt(i - 1);
      for (j = 1; j <= m; j++) {
        var sub = prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 2);
        var del = prev[j] + 1, ins = cur[j - 1] + 1;
        cur[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
      }
      prev = cur;
    }
    return prev[m];
  }

  function ratio(a, b) {
    if (!a && !b) return 100;
    if (!a || !b) return 0;
    return 100 - 100 * indel(a, b) / (a.length + b.length);
  }

  function partialRatio(s1, s2) {
    if (s1.length > s2.length) { var swap = s1; s1 = s2; s2 = swap; }
    if (!s1.length) return 0;
    var set = {}, i;
    for (i = 0; i < s1.length; i++) set[s1.charAt(i)] = 1;
    var best = 0, n = s1.length, m = s2.length;
    function take(sub) {
      var sc = ratio(s1, sub);
      if (sc > best) best = sc;
      return best >= 99.999;
    }
    for (i = 1; i < n && i <= m; i++) {
      if (!set[s2.charAt(i - 1)]) continue;
      if (take(s2.slice(0, i))) return 100;
    }
    for (i = 0; i <= m - n; i++) {
      if (!set[s2.charAt(i + n - 1)]) continue;
      if (take(s2.slice(i, i + n))) return 100;
    }
    for (i = Math.max(0, m - n); i < m; i++) {
      if (!set[s2.charAt(i)]) continue;
      if (take(s2.slice(i))) return 100;
    }
    return best;
  }

  function tokenSetRatio(s1, s2) {
    function tokens(s) {
      var out = {}, parts = s.split(/\s+/), i;
      for (i = 0; i < parts.length; i++) if (parts[i]) out[parts[i]] = 1;
      return out;
    }
    function keys(obj) { var k, out = []; for (k in obj) if (obj[k]) out.push(k); return out; }
    var A = tokens(s1), B = tokens(s2);
    var ka = keys(A), kb = keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = [], dab = [], dba = [], i;
    for (i = 0; i < ka.length; i++) (B[ka[i]] ? inter : dab).push(ka[i]);
    for (i = 0; i < kb.length; i++) if (!A[kb[i]]) dba.push(kb[i]);
    if (inter.length && (!dab.length || !dba.length)) return 100;
    dab.sort(); dba.sort();
    var dabS = dab.join(" "), dbaS = dba.join(" ");
    var sectLen = inter.length ? inter.join(" ").length : 0;
    var abLen = dabS.length, baLen = dbaS.length;
    var sectAb = sectLen + (sectLen ? 1 : 0) + abLen;
    var sectBa = sectLen + (sectLen ? 1 : 0) + baLen;
    var lensum = sectAb + sectBa;
    var result = lensum ? 100 - 100 * indel(dabS, dbaS) / lensum : 100;
    if (!sectLen) return result;
    var abRatio = 100 - 100 * ((sectLen ? 1 : 0) + abLen) / (sectLen + sectAb);
    var baRatio = 100 - 100 * ((sectLen ? 1 : 0) + baLen) / (sectLen + sectBa);
    return Math.max(result, abRatio, baRatio);
  }

  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    return Math.max(tokenSetRatio(a, b), a.length >= 4 ? partialRatio(a, b) : 0);
  }

  function pushErr(errors, path, message) { errors.push({path: path, message: message}); }

  function pyLiteral(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "string") return pyRepr(v);
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return "[" + v.map(pyLiteral).join(", ") + "]";
    return String(v);
  }

  function typeMsg(v, types) {
    return pyLiteral(v) + " is not of type " + types.map(function (t) { return "'" + t + "'"; }).join(", ");
  }

  function schemaErrors(data) {
    var errors = [];
    function requireProps(obj, keys, path) {
      keys.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) pushErr(errors, path, "'" + k + "' is a required property");
      });
    }
    function extraProps(obj, allowed, path) {
      var extra = Object.keys(obj).filter(function (k) { return !allowed[k]; });
      if (!extra.length) return;
      var quoted = extra.map(function (k) { return "'" + k + "'"; }).join(", ");
      pushErr(errors, path, "Additional properties are not allowed (" + quoted + " " +
        (extra.length === 1 ? "was" : "were") + " unexpected)");
    }
    function stringOrNull(v, path) {
      if (v !== null && typeof v !== "string") pushErr(errors, path, typeMsg(v, ["string", "null"]));
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      pushErr(errors, [], typeMsg(data, ["object"]));
      return errors;
    }
    requireProps(data, ["form", "answers"], []);
    extraProps(data, {form: 1, answers: 1}, []);
    var form = data.form;
    if (Object.prototype.hasOwnProperty.call(data, "form")) {
      if (!form || typeof form !== "object" || Array.isArray(form)) {
        pushErr(errors, ["form"], typeMsg(form, ["object"]));
      } else {
        requireProps(form, ["zone_map"], ["form"]);
        extraProps(form, {title:1, id:1, revision:1, file_name:1, zone_map:1, pages:1, issuer:1, respondent:1}, ["form"]);
        if (Object.prototype.hasOwnProperty.call(form, "title") && typeof form.title !== "string") {
          pushErr(errors, ["form", "title"], typeMsg(form.title, ["string"]));
        }
        if (Object.prototype.hasOwnProperty.call(form, "file_name") && typeof form.file_name !== "string") {
          pushErr(errors, ["form", "file_name"], typeMsg(form.file_name, ["string"]));
        }
        ["id", "revision", "issuer", "respondent"].forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(form, k)) stringOrNull(form[k], ["form", k]);
        });
        if (Object.prototype.hasOwnProperty.call(form, "zone_map")) {
          if (typeof form.zone_map !== "string") pushErr(errors, ["form", "zone_map"], typeMsg(form.zone_map, ["string"]));
          else if (!MAP_RE.test(form.zone_map)) pushErr(errors, ["form", "zone_map"], "'" + form.zone_map + "' does not match '^[0-9a-f]{8}$'");
        }
        if (Object.prototype.hasOwnProperty.call(form, "pages") && form.pages !== null && !(typeof form.pages === "number" && Number.isInteger(form.pages))) {
          pushErr(errors, ["form", "pages"], typeMsg(form.pages, ["integer", "null"]));
        }
      }
    }
    if (!Array.isArray(data.answers)) {
      if (Object.prototype.hasOwnProperty.call(data, "answers")) pushErr(errors, ["answers"], typeMsg(data.answers, ["array"]));
    } else if (!data.answers.length) {
      pushErr(errors, ["answers"], "[] should be non-empty");
    } else data.answers.forEach(function (a, i) {
      var path = ["answers", i];
      if (!a || typeof a !== "object" || Array.isArray(a)) { pushErr(errors, path, typeMsg(a, ["object"])); return; }
      requireProps(a, ["ref", "label", "type"], path);
      var typeKnown = Object.prototype.hasOwnProperty.call(a, "type");
      if (a.do_not_fill !== true) {
        if (!typeKnown || a.type === "choice") requireProps(a, ["choice", "zone"], path);
        if (!typeKnown || a.type === "multi_choice") requireProps(a, ["options_checked", "zones"], path);
        if (!typeKnown || a.type === "text" || a.type === "date") requireProps(a, ["value", "zone"], path);
      }
      extraProps(a, {ref:1, page:1, label:1, context:1, type:1, zone:1, zones:1, value:1, choice:1, options_checked:1, remark:1, remark_zone:1, inline_text:1, inline_zone:1, confidence:1, source:1, note_for_reviewer:1, do_not_fill:1}, path);
      if (Object.prototype.hasOwnProperty.call(a, "ref")) {
        if (typeof a.ref !== "string") pushErr(errors, path.concat("ref"), typeMsg(a.ref, ["string"]));
        else if (!a.ref.length) pushErr(errors, path.concat("ref"), "'' should be non-empty");
      }
      if (Object.prototype.hasOwnProperty.call(a, "label")) {
        if (typeof a.label !== "string") pushErr(errors, path.concat("label"), typeMsg(a.label, ["string"]));
        else if (!a.label.length) pushErr(errors, path.concat("label"), "'' should be non-empty");
      }
      if (typeKnown && ["text", "date", "choice", "multi_choice", "signature"].indexOf(a.type) < 0) {
        pushErr(errors, path.concat("type"), pyLiteral(a.type) + " is not one of ['text', 'date', 'choice', 'multi_choice', 'signature']");
      }
      if (Object.prototype.hasOwnProperty.call(a, "page") && a.page !== null) {
        if (!(typeof a.page === "number" && Number.isInteger(a.page))) pushErr(errors, path.concat("page"), typeMsg(a.page, ["integer", "null"]));
        else if (a.page < 1) pushErr(errors, path.concat("page"), a.page + " is less than the minimum of 1");
      }
      ["context", "value", "choice", "remark", "inline_text", "source", "note_for_reviewer"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(a, k)) stringOrNull(a[k], path.concat(k));
      });
      ["zone", "remark_zone", "inline_zone"].forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(a, k) || a[k] === null) return;
        if (typeof a[k] !== "string") pushErr(errors, path.concat(k), typeMsg(a[k], ["string", "null"]));
        else if (!ZONE_RE.test(a[k])) pushErr(errors, path.concat(k), pyRepr(a[k]) + " does not match '^Z[0-9]+$'");
      });
      if (Object.prototype.hasOwnProperty.call(a, "zones")) {
        if (!Array.isArray(a.zones)) pushErr(errors, path.concat("zones"), typeMsg(a.zones, ["array"]));
        else a.zones.forEach(function (z, zi) {
          if (typeof z !== "string") pushErr(errors, path.concat("zones", zi), typeMsg(z, ["string"]));
          else if (!ZONE_RE.test(z)) pushErr(errors, path.concat("zones", zi), pyRepr(z) + " does not match '^Z[0-9]+$'");
        });
      }
      if (Object.prototype.hasOwnProperty.call(a, "options_checked")) {
        if (!Array.isArray(a.options_checked)) pushErr(errors, path.concat("options_checked"), typeMsg(a.options_checked, ["array"]));
        else a.options_checked.forEach(function (opt, k) {
          if (typeof opt !== "string") pushErr(errors, path.concat("options_checked", k), typeMsg(opt, ["string"]));
        });
      }
      if (Object.prototype.hasOwnProperty.call(a, "confidence") && ["high", "medium", "low"].indexOf(a.confidence) < 0) {
        pushErr(errors, path.concat("confidence"), pyLiteral(a.confidence) + " is not one of ['high', 'medium', 'low']");
      }
      if (Object.prototype.hasOwnProperty.call(a, "do_not_fill") && typeof a.do_not_fill !== "boolean") {
        pushErr(errors, path.concat("do_not_fill"), typeMsg(a.do_not_fill, ["boolean"]));
      }
    });
    errors.sort(function (a, b) {
      var n = Math.max(a.path.length, b.path.length), i;
      for (i = 0; i < n; i++) {
        var av = a.path[i], bv = b.path[i];
        if (av === undefined) return -1;
        if (bv === undefined) return 1;
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    });
    return errors.map(function (e) {
      var loc = e.path.map(String).join("/") || "(racine)";
      return loc + ": " + e.message;
    });
  }

  function writesOf(a) {
    var out = [];
    if ((a.type === "text" || a.type === "date") && a.value) out.push(["value", a.zone, "text", a.value]);
    else if (a.type === "choice" && a.choice) out.push(["choice", a.zone, "check", a.choice]);
    else if (a.type === "multi_choice") {
      var zones = a.zones || [];
      (a.options_checked || []).forEach(function (opt, k) {
        out.push(["option", k < zones.length ? zones[k] : null, "check", opt]);
      });
    }
    if (a.remark) out.push(["remark", a.remark_zone, "text", a.remark]);
    if (a.inline_text) out.push(["inline", a.inline_zone, "text", a.inline_text]);
    return out;
  }

  function shortCtx(ctx) {
    return Object.keys(ctx).filter(function (k) { return ctx[k] && k !== "line" && k !== "field_name"; })
      .map(function (k) { return k + ": " + String(ctx[k]).slice(0, 40); }).join(" ; ").slice(0, 160);
  }

  function fitMessage(a, role, payload, zone) {
    var ctx = zone.ctx || {};
    var around = Object.keys(ctx).map(function (k) { return ctx[k]; }).filter(Boolean);
    if (!around.length) return null;
    var blob = norm(around.join(" "));
    var ref = norm(a.ref);
    if (role === "choice" || role === "option") {
      var side = ["col", "above", "right"].map(function (k) { return ctx[k]; }).filter(Boolean);
      if (!side.length) side = around;
      var col = Math.max.apply(null, side.map(function (v) { return similarity(payload, v); }));
      if (col < FIT_MIN) return zone.id + " : « " + payload + " » ne figure pas autour de la case (" + shortCtx(ctx) + ")";
      if (role === "choice") {
        var rowVals = ["row", "left", "line"].map(function (k) { return ctx[k]; }).filter(Boolean);
        if (!rowVals.length) rowVals = around;
        var row = Math.max.apply(null, rowVals.map(function (v) { return similarity(a.label, v); }).concat(
          rowVals.map(function (v) { return similarity(a.context || "", v); })));
        if (row < FIT_MIN && !(ref.length >= 2 && (" " + blob + " ").indexOf(" " + ref + " ") >= 0)) {
          return zone.id + " : la ligne de cette case ne ressemble pas à la question (" + shortCtx(ctx) + ")";
        }
      }
      return null;
    }
    var cands = [a.label, a.context || ""].filter(Boolean);
    var score = 0;
    cands.forEach(function (c) { around.forEach(function (v) { var s = similarity(c, v); if (s > score) score = s; }); });
    if (role === "remark" || role === "inline" || score >= FIT_MIN) return null;
    if (ref.length >= 2 && (" " + blob + " ").indexOf(" " + ref + " ") >= 0) return null;
    return zone.id + " : le texte autour de la zone ne ressemble pas au libellé « " + String(a.label).slice(0, 50) + " » (" + shortCtx(ctx) + ")";
  }

  function validateAnswers(data, zmap) {
    var errors = schemaErrors(data), warnings = [], fit = {};
    if (errors.length) return {errors: errors, warnings: warnings, fit: fit};
    var zones = {};
    (zmap.zones || []).forEach(function (z) { zones[z.id] = z; });
    if (data.form.zone_map !== zmap.map_id) {
      errors.push("form.zone_map vaut " + pyRepr(data.form.zone_map) + " mais la carte des zones actuelle est " +
        pyRepr(zmap.map_id) + " : réponses produites sur un autre zones.txt, refaire avec les fichiers actuels");
    }
    var used = {};
    data.answers.forEach(function (a, i) {
      var where = "answers[" + i + "] (ref " + pyRepr(a.ref) + ", " + pyRepr(String(a.label).slice(0, 40)) + ")";
      if (RANGE_RE.test(a.ref) || String(a.ref).indexOf(",") >= 0) {
        errors.push(where + ": ref regroupe plusieurs questions; une entrée par question est exigée");
      }
      ["value", "remark", "inline_text", "choice"].forEach(function (fld) {
        var s = a[fld];
        if (!s) return;
        if (MARKDOWN_RE.test(s)) errors.push(where + "." + fld + ": contient du markdown (" + pyRepr(String(s).slice(0, 40)) + "); texte brut exigé");
        if (REDIRECT_RE.test(s)) errors.push(where + "." + fld + ": lien de redirection Google (" + pyRepr(String(s).slice(0, 60)) + "); mettre l'URL réelle");
        if (PLACEHOLDER_RE.test(s)) errors.push(where + "." + fld + ": placeholder (" + pyRepr(String(s).slice(0, 40)) + "); mettre null + note_for_reviewer");
      });
      if (a.type === "choice" && a.options_checked && !(Array.isArray(a.options_checked) && a.options_checked.length === 0)) {
        errors.push(where + ": options_checked interdit pour type 'choice'");
      }
      if ((a.type === "text" || a.type === "date") && a.choice) errors.push(where + ": champ 'choice' inattendu pour type " + pyRepr(a.type));
      if (a.type === "multi_choice" && (a.zones || []).length !== (a.options_checked || []).length) {
        errors.push(where + ": 'zones' doit avoir une zone par élément de options_checked, dans le même ordre");
      }
      if ((a.value == null) && (a.type === "text" || a.type === "date") && !a.note_for_reviewer && !a.do_not_fill) {
        warnings.push(where + ": valeur vide sans note_for_reviewer");
      }
      if (a.do_not_fill || a.type === "signature") return;
      writesOf(a).forEach(function (w) {
        var role = w[0], zid = w[1], op = w[2], payload = w[3];
        if (zid == null) {
          warnings.push(where + ": aucune zone pour " + ROLE_FR[role] + " « " + String(payload).slice(0, 40) + " » (à reporter à la main)");
          return;
        }
        var z = zones[zid];
        if (!z) { errors.push(where + ": zone " + zid + " inexistante dans zones.txt"); return; }
        if (op === "check" && z.kind === "text") errors.push(where + ": " + zid + " est une zone de texte, pas une case à cocher");
        else if (op === "text" && z.kind === "check") errors.push(where + ": " + zid + " est une case à cocher, pas une zone de texte (" + ROLE_FR[role] + ")");
        if (Object.prototype.hasOwnProperty.call(used, zid)) {
          errors.push(where + ": zone " + zid + " déjà utilisée par answers[" + used[zid] + "] ; une zone = une réponse");
        }
        used[zid] = i;
        if (op === "text" && z.max_length && Array.from(String(payload)).length > z.max_length) {
          warnings.push(where + ": " + zid + " limitée à " + z.max_length + " caractères (" + Array.from(String(payload)).length + " fournis)");
        }
        if (op === "text" && z.cells) {
          var n = z.cells.length, compact = String(payload).replace(/[\s/.\-]/g, "");
          if (payload.length !== n && compact.length !== n) {
            warnings.push(where + ": " + zid + " a " + n + " cases, la valeur « " + payload + " » n'y tient pas exactement");
          }
        }
        if (op === "text" && z.choices && z.choices.indexOf(payload) < 0) {
          errors.push(where + ": " + zid + " n'accepte que : " + z.choices.slice(0, 12).join(" / "));
        }
        var msg = fitMessage(a, role, payload, z);
        if (msg) { if (!fit[i]) fit[i] = []; fit[i].push(msg); }
      });
      if (a.remark && a.remark.length > 160) warnings.push(where + ": remark longue (" + a.remark.length + " car.), risque de débordement");
    });
    return {errors: errors, warnings: warnings, fit: fit};
  }

  function formatForGem(errors) {
    return ["Le JSON produit ne respecte pas le format attendu. Corrige uniquement ces points et renvoie le JSON complet :"]
      .concat(errors.map(function (e) { return "- " + e; })).join("\n");
  }

  function sameText(prefilled, value) {
    var a = norm(prefilled), b = norm(value);
    return !!(a && b) && (a === b || a.indexOf(b) >= 0);
  }

  function buildPlan(zmap, data, fit) {
    var zones = {};
    zmap.zones.forEach(function (z) { zones[z.id] = z; });
    fit = fit || {};
    var ops = [], answers = [], used = {}, ignored = {};
    data.answers.forEach(function (a, i) {
      var info = {
        index: i, ref: a.ref, label: a.label, context: a.context == null ? null : a.context, type: a.type,
        confidence: a.confidence || "high",
        source: a.source == null || a.source === "" ? null : a.source,
        note: a.note_for_reviewer == null ? null : a.note_for_reviewer,
        zones: [], messages: (fit[i] || []).slice()
      };
      answers.push(info);
      if (a.do_not_fill || a.type === "signature") {
        info.status = "skipped";
        [a.zone].concat(a.zones || []).forEach(function (zid) { if (zid) ignored[zid] = 1; });
        return;
      }
      var writes = writesOf(a);
      if (!writes.length) {
        info.status = "empty";
        if (a.zone) info.zones.push(a.zone);
        return;
      }
      var flag = info.confidence !== "high" || !!info.note || !!info.messages.length;
      var placed = 0, already = 0, conflict = 0, missing = 0;
      writes.forEach(function (w) {
        var role = w[0], zid = w[1], op = w[2], payload = w[3];
        if (!zid) {
          missing++;
          info.messages.push("aucune zone pour " + ROLE_FR[role] + " « " + String(payload).slice(0, 60) + " » : à reporter à la main");
          return;
        }
        var z = zones[zid];
        info.zones.push(zid);
        used[zid] = 1;
        if (op === "check") {
          if (z.checked) { already++; return; }
          ops.push({op: "check", zone: zid, answer: i, role: role, flag: flag});
        } else {
          var pre = z.prefilled;
          if (pre) {
            if (sameText(pre, payload)) already++;
            else {
              conflict++;
              info.messages.push(zid + " contient déjà « " + String(pre).slice(0, 60) + " » : « " + String(payload).slice(0, 60) + " » non écrit");
            }
            return;
          }
          ops.push({op: "text", zone: zid, answer: i, role: role, text: payload, flag: flag});
        }
        placed++;
      });
      if (conflict) info.status = "conflict";
      else if (missing) info.status = (placed || already) ? "partial" : "no_zone";
      else if (placed) info.status = "placed";
      else info.status = "already_filled";
    });
    return {ops: ops, answers: answers, unused: unusedZones(zmap.zones, used, ignored), map_id: zmap.map_id, detector: zmap.detector};
  }

  function unusedZones(zones, used, ignored) {
    var anyRects = zones.filter(function (z) { return z.kind === "any" && z.page; }).map(function (z) {
      return {id: z.id, page: z.page, rect: z.rect};
    });
    var out = [];
    zones.forEach(function (z) {
      if (used[z.id] || ignored[z.id] || z.kind === "check" || z.prefilled) return;
      if (z.kind === "any" && z.page) {
        var y0 = z.rect[1], y1 = z.rect[3];
        var shared = anyRects.some(function (o) {
          return o.id !== z.id && o.page === z.page && o.rect[1] < y1 && o.rect[3] > y0;
        });
        if (shared) return;
      }
      out.push(z.id);
    });
    return out;
  }

  function wrap(font, text, width, fs) {
    var lines = [];
    String(text).split("\n").forEach(function (para) {
      var cur = "";
      para.split(/\s+/).filter(Boolean).forEach(function (word) {
        var cand = (cur ? cur + " " : "") + word;
        if (font.widthOfTextAtSize(cand, fs) <= width) { cur = cand; return; }
        if (cur) lines.push(cur);
        while (font.widthOfTextAtSize(word, fs) > width && word.length > 1) {
          var k = word.length;
          while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), fs) > width) k--;
          lines.push(word.slice(0, k));
          word = word.slice(k);
        }
        cur = word;
      });
      lines.push(cur);
    });
    return lines.filter(function (ln) { return ln; }).length ? lines.filter(function (ln) { return ln; }) : [""];
  }

  function putText(page, x, yDown, text, fs, font, H) {
    page.drawText(text, {x: x, y: H - yDown, size: fs, font: font});
  }

  function drawCheck(page, rect, shape, bold, H) {
    var r = {x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3]};
    if (shape === "bracket") {
      var trim = Math.min((r.x1 - r.x0) * 0.22, (r.y1 - r.y0) * 0.35);
      r = {x0: r.x0 + trim, y0: r.y0, x1: r.x1 - trim, y1: r.y1};
      var side = Math.min(r.x1 - r.x0, (r.y1 - r.y0) * 0.8);
    } else if (shape === "cell") {
      side = Math.min(r.x1 - r.x0, r.y1 - r.y0, 10) * 0.85;
    } else if (shape === "circle") {
      side = Math.min(r.x1 - r.x0, r.y1 - r.y0) * 0.85;
    } else {
      side = Math.min(r.x1 - r.x0, r.y1 - r.y0);
    }
    var fs = side * 1.15;
    var w = bold.widthOfTextAtSize("X", fs);
    var cap = 0.716 * fs;
    putText(page, (r.x0 + r.x1) / 2 - w / 2, (r.y0 + r.y1) / 2 + cap / 2, "X", fs, bold, H);
  }

  function drawBoxText(page, rect, text, maxFs, font, H) {
    var r = {x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3]};
    var pad = 1.5, width = (r.x1 - r.x0) - 2 * pad, height = (r.y1 - r.y0) - 1;
    var fs = Math.min(maxFs, Math.max(MIN_FS, height / LINE_GAP));
    var lines, total;
    while (true) {
      lines = wrap(font, text, width, fs);
      total = lines.length * fs * LINE_GAP;
      if (total <= height + 0.5 || fs <= MIN_FS) break;
      fs = Math.round((fs - 0.25) * 100) / 100;
    }
    var y = (r.y1 - r.y0) > 4 * maxFs * LINE_GAP ? r.y0 + 2 : r.y0 + Math.max(0, ((r.y1 - r.y0) - total) / 2);
    lines.forEach(function (ln, k) {
      putText(page, r.x0 + pad, y + fs * 0.88 + k * fs * LINE_GAP, ln, fs, font, H);
    });
    return {fontsize: fs, lines: lines.length, overflow: total > height + 0.5};
  }

  function drawLineText(page, rects, text, maxFs, font, H) {
    var pad = 1.5;
    var fs = Math.min(maxFs, Math.min.apply(null, rects.map(function (r) { return r[3] - r[1]; })) * 0.85);
    var placed, remaining;
    while (true) {
      remaining = String(text).split(/\s+/).filter(Boolean);
      placed = [];
      rects.forEach(function (r) {
        var cur = "";
        while (remaining.length) {
          var cand = (cur ? cur + " " : "") + remaining[0];
          if (font.widthOfTextAtSize(cand, fs) <= (r[2] - r[0]) - 2 * pad) { cur = cand; remaining.shift(); }
          else break;
        }
        placed.push(cur);
      });
      if (!remaining.length || fs <= MIN_FS) break;
      fs = Math.round((fs - 0.25) * 100) / 100;
    }
    var overflow = remaining.length > 0;
    if (overflow) placed[placed.length - 1] = (placed[placed.length - 1] + " " + remaining.join(" ")).trim();
    placed.forEach(function (ln, i) {
      if (ln) putText(page, rects[i][0] + pad, rects[i][3] - 2, ln, fs, font, H);
    });
    return {fontsize: fs, lines: placed.filter(Boolean).length, overflow: overflow};
  }

  function drawComb(page, cells, text, font, H) {
    var chars = String(text).split("");
    if (chars.length !== cells.length) chars = String(text).replace(/[\s/.\-]/g, "").split("");
    var fs = Math.min(11, Math.min.apply(null, cells.map(function (c) { return c[3] - c[1]; })) * 0.7);
    cells.forEach(function (c, i) {
      if (i >= chars.length) return;
      var w = font.widthOfTextAtSize(chars[i], fs);
      putText(page, (c[0] + c[2]) / 2 - w / 2, (c[1] + c[3]) / 2 + 0.36 * fs, chars[i], fs, font, H);
    });
    return {fontsize: fs, lines: 1, overflow: chars.length > cells.length};
  }

  function widgetIndex(doc) {
    var form;
    try { form = doc.getForm(); } catch (err) { return null; }
    var byObj = {};
    var ctx = doc.context;
    form.getFields().forEach(function (field) {
      var widgets = field.acroField && field.acroField.getWidgets ? field.acroField.getWidgets() : [];
      widgets.forEach(function (widget) {
        var ref = ctx.getObjectRef(widget.dict);
        if (ref) byObj[ref.objectNumber] = field;
      });
    });
    return {form: form, byObj: byObj, written: []};
  }

  function writeWidget(index, z, op) {
    var field = z.xref ? index.byObj[z.xref] : null;
    if (!field && z.ctx && z.ctx.field_name) {
      try { field = index.form.getField(z.ctx.field_name); } catch (err) { field = null; }
    }
    if (!field) return false;
    if (op.op === "check") {
      if (typeof field.check === "function") field.check();
      else if (typeof field.select === "function" && z.export_value) field.select(z.export_value);
      else return false;
    } else if (typeof field.setText === "function") {
      field.setText(op.text == null ? "" : String(op.text));
    } else if (typeof field.select === "function") {
      field.select(op.text == null ? "" : String(op.text));
    } else return false;
    index.written.push(field);
    return true;
  }

  async function fillPdf(bytes, ops, zones, PDFLib, fonts) {
    var doc = await PDFLib.PDFDocument.load(bytes);
    var reg, bold;
    if (fonts && fonts.regular) {
      if (fonts.fontkit) doc.registerFontkit(fonts.fontkit);
      reg = await doc.embedFont(fonts.regular);
      bold = await doc.embedFont(fonts.bold || fonts.regular);
    } else {
      reg = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    }
    var pages = doc.getPages();
    var results = [];
    var fields = null;
    var widgetWrites = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i], z = zones[op.zone];
      var page = pages[z.page - 1];
      var H = page.getHeight();
      var maxFs = op.role === "remark" ? REMARK_FS : MAX_FS;
      if (z.shape === "widget") {
        if (!fields) fields = widgetIndex(doc);
        var wrote = false;
        if (fields) {
          try { wrote = writeWidget(fields, z, op); }
          catch (err) { wrote = false; }
        }
        if (wrote) {
          widgetWrites += 1;
          results.push({op: op, ok: true, overflow: false});
          continue;
        }
      }
      if (op.op === "check") {
        drawCheck(page, z.rect, z.shape, bold, H);
        results.push({op: op, ok: true, overflow: false});
        continue;
      }
      var info;
      if (z.cells) info = drawComb(page, z.cells, op.text, reg, H);
      else if (LINE_SHAPES[z.shape]) info = drawLineText(page, [z.rect].concat(z.extra || []), op.text, maxFs, reg, H);
      else info = drawBoxText(page, z.rect, op.text, maxFs, reg, H);
      results.push({op: op, ok: !info.overflow, fontsize: info.fontsize, lines: info.lines, overflow: info.overflow});
    }
    if (widgetWrites && fields) {
      try { fields.form.updateFieldAppearances(reg); }
      catch (err) {
        fields.written.forEach(function (field) {
          try { if (field.updateAppearances) field.updateAppearances(reg); } catch (e) {}
        });
      }
    }
    return {doc: doc, results: results};
  }

  function zoneRect(z) {
    var r = z.rect.slice();
    (z.extra || []).forEach(function (e) {
      r[0] = Math.min(r[0], e[0]); r[1] = Math.min(r[1], e[1]);
      r[2] = Math.max(r[2], e[2]); r[3] = Math.max(r[3], e[3]);
    });
    return r;
  }

  function expand(r, d) {
    return [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
  }

  function popupTitle(kind, lines) {
    var base = STYLE[kind].title, i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      if (line.indexOf("Zone ") === 0) return base + " · " + line.split(/\s+/)[1];
      if (line.charAt(0) === "Z" && line.length > 1 && line.charAt(1) >= "0" && line.charAt(1) <= "9") {
        return base + " · " + line.split(/\s+/)[0].replace(/—$/, "").trim();
      }
    }
    return base;
  }

  function pdfRect(r, H) { return [r[0], H - r[3], r[2], H - r[1]]; }

  function mark(pdfDoc, page, rectDown, lines, kind, PDFLib) {
    var style = STYLE[kind];
    var body = lines.map(function (ln) { return String(ln).trim(); }).filter(Boolean).join("\n");
    var title = popupTitle(kind, lines);
    var H = page.getHeight();
    var W = page.getWidth();
    // add_rect_annot inflates /Rect by the default 1pt border, then set_border
    // changes the stroke without touching /Rect again.
    var annotDown = expand(rectDown, 1);
    var box = pdfRect(annotDown, H);
    var draw = pdfRect(rectDown, H);
    page.drawRectangle({
      x: draw[0], y: draw[1], width: Math.max(draw[2] - draw[0], 0.2), height: Math.max(draw[3] - draw[1], 0.2),
      color: PDFLib.rgb(style.fill[0], style.fill[1], style.fill[2]), opacity: 0.45, borderWidth: 0
    });
    page.drawRectangle({
      x: draw[0], y: draw[1], width: Math.max(draw[2] - draw[0], 0.2), height: Math.max(draw[3] - draw[1], 0.2),
      borderColor: PDFLib.rgb(style.popup[0], style.popup[1], style.popup[2]), borderWidth: style.border
    });
    var ctx = pdfDoc.context;
    var annot = ctx.obj({
      Type: "Annot", Subtype: "Square",
      Rect: box,
      C: style.popup,
      BS: {W: style.border, S: "S"},
      Contents: PDFLib.PDFHexString.fromText(body),
      T: PDFLib.PDFHexString.fromText(title),
      Subj: PDFLib.PDFString.of(kind),
      F: 4
    });
    annot.set(PDFLib.PDFName.of("RD"), ctx.obj([1, 1, 1, 1]));
    var stroke = style.popup.map(function (n) {
      var s = String(Math.round(n * 100) / 100);
      if (s.charAt(0) === "0") s = s.slice(1);
      return s;
    }).join(" ");
    var apBody = style.border + " w\n" + stroke + " RG\n" +
      draw[0] + " " + draw[1] + " " + (draw[2] - draw[0]) + " " + (draw[3] - draw[1]) + " re\nS\n";
    var apRef = ctx.register(ctx.stream(apBody, {
      Type: "XObject", Subtype: "Form", BBox: box, Matrix: [1, 0, 0, 1, 0, 0]
    }));
    annot.set(PDFLib.PDFName.of("AP"), ctx.obj({N: apRef}));
    var annotRef = ctx.register(annot);
    var linesN = body.split("\n").length;
    var popH = Math.max(70, 16 * (linesN + 1));
    var pop = [rectDown[2] + 8, rectDown[1], rectDown[2] + 260, rectDown[1] + popH];
    if (pop[2] > W - 4) pop = [Math.max(4, rectDown[0] - 260), rectDown[1], rectDown[0] - 8, rectDown[1] + popH];
    if (pop[0] < 4) pop = [4, pop[1], Math.min(W - 4, 256), pop[3]];
    var pageH = H;
    if (pop[3] > pageH - 4) { var dy = pageH - 4 - pop[3]; pop[1] += dy; pop[3] += dy; }
    if (pop[1] < 4) { dy = 4 - pop[1]; pop[1] += dy; pop[3] += dy; }
    var popPdf = pdfRect(pop, H);
    var popup = ctx.obj({
      Type: "Annot", Subtype: "Popup",
      Rect: popPdf, Parent: annotRef, Open: false, F: 4, C: style.popup
    });
    var popupRef = ctx.register(popup);
    annot.set(PDFLib.PDFName.of("Popup"), popupRef);
    var name = PDFLib.PDFName.of("Annots");
    var existing = page.node.lookup(name);
    var arr;
    if (existing) arr = page.node.context.lookup(existing);
    if (!arr || typeof arr.push !== "function") {
      arr = ctx.obj([]);
      page.node.set(name, arr);
    }
    arr.push(annotRef);
    arr.push(popupRef);
  }

  function checkPlanZones(plan, zmap) {
    if (plan.map_id && zmap.map_id && plan.map_id !== zmap.map_id) {
      throw new Error("carte de zones incompatible : plan map_id=" + plan.map_id + " mais zones/ map_id=" + zmap.map_id);
    }
    var known = {};
    zmap.zones.forEach(function (z) { known[z.id] = 1; });
    var missing = {};
    (plan.ops || []).forEach(function (o) { if (o.zone && !known[o.zone]) missing[o.zone] = 1; });
    (plan.unused || []).forEach(function (zid) { if (zid && !known[zid]) missing[zid] = 1; });
    var ids = Object.keys(missing).sort();
    if (ids.length) throw new Error("plan.json référence des zones absentes de la carte actuelle : " + ids.slice(0, 12).join(", "));
  }

  function reviewOn(doc, plan, zmap, fillResults, PDFLib) {
    checkPlanZones(plan, zmap);
    var zones = {};
    zmap.zones.forEach(function (z) { zones[z.id] = z; });
    var overflow = {};
    var failed = {};
    fillResults.forEach(function (r) {
      var key = r.op.answer + ":" + r.op.zone;
      if (r.overflow) overflow[key] = 1;
      if (r.ok === false) failed[key] = r.error || "écriture impossible";
    });
    var byAnswer = {};
    plan.ops.forEach(function (op) {
      if (!byAnswer[op.answer]) byAnswer[op.answer] = [];
      byAnswer[op.answer].push(op);
    });
    var pages = doc.getPages();
    plan.answers.forEach(function (ans) {
      var head = "[" + ans.ref + "] " + String(ans.label).slice(0, 70);
      (byAnswer[ans.index] || []).forEach(function (op) {
        var z = zones[op.zone];
        if (!z || !z.page) return;
        var over = !!overflow[ans.index + ":" + op.zone];
        var fail = failed[ans.index + ":" + op.zone];
        var toCheck = op.flag || over || fail;
        var lines = [head, "Zone " + op.zone, "Confiance  " + (ans.confidence || "—")];
        if (ans.source) lines.push("Source  " + ans.source);
        var kind;
        if (toCheck) {
          lines.push("Statut  à vérifier");
          if (ans.note) lines.push("Note  " + ans.note);
          (ans.messages || []).forEach(function (m) { if (m) lines.push("• " + m); });
          if (over) lines.push("• texte trop long pour la zone");
          if (fail) lines.push("• " + fail);
          kind = "check";
        } else {
          lines.push("Statut  ajout OK");
          kind = "ok";
        }
        mark(doc, pages[z.page - 1], expand(zoneRect(z), 1.5), lines, kind, PDFLib);
      });
      if (ans.status === "conflict" || ans.status === "empty") {
        ans.zones.forEach(function (zid) {
          var z = zones[zid];
          if (!z || !z.page) return;
          var why = ans.note || (ans.messages || []).join(" ") || ans.status;
          mark(doc, pages[z.page - 1], expand(zoneRect(z), 3), [head, "Zone " + zid, "Statut  " + ans.status, why], "error", PDFLib);
        });
      }
    });
    plan.unused.forEach(function (zid) {
      var z = zones[zid];
      if (!z || !z.page) return;
      var ctx = Object.keys(z.ctx || {}).filter(function (k) { return z.ctx[k] && k !== "line"; })
        .map(function (k) { return k + ": " + z.ctx[k]; }).join(" · ");
      var lines = ["Zone " + zid, "Statut  sans réponse"];
      if (ctx) lines.push(ctx.slice(0, 220));
      mark(doc, pages[z.page - 1], expand(zoneRect(z), 3), lines, "error", PDFLib);
    });
  }

  async function run(pdfBytes, zmap, data, PDFLib, opts) {
    opts = opts || {};
    var checked = validateAnswers(data, zmap);
    if (checked.errors.length) {
      return {errors: checked.errors, warnings: checked.warnings, feedback: formatForGem(checked.errors)};
    }
    var plan = buildPlan(zmap, data, checked.fit);
    var zones = {};
    zmap.zones.forEach(function (z) { zones[z.id] = z; });
    var filled = await fillPdf(pdfBytes, plan.ops, zones, PDFLib, opts.fonts);
    var filledBytes = await filled.doc.save();
    var reviewDoc = await PDFLib.PDFDocument.load(filledBytes);
    reviewOn(reviewDoc, plan, zmap, filled.results, PDFLib);
    var reviewBytes = await reviewDoc.save();
    return {errors: [], warnings: checked.warnings, plan: plan, results: filled.results, filled: filledBytes, review: reviewBytes};
  }

  return {norm: norm, similarity: similarity, validateAnswers: validateAnswers, buildPlan: buildPlan, run: run, formatForGem: formatForGem};
})();

if (typeof module === "object" && module.exports) module.exports = Run;
