/* prepare : détecte les zones d'un PDF (implémentation canonique JS).
   Repère interne : origine en haut à gauche, y vers le bas.
   pdf.js et pdf-lib restent en repère PDF (origine en bas). La conversion est faite ici. */
const Prepare = (function () {
  "use strict";

  var DETECTOR_VERSION = "zones-js-1";
  var BOX_GLYPHS = "☐☑☒□▢❑❒❏❐◻⬜○◯❍";
  var CHECK_GLYPHS = "☑☒✓✔✗✘xX";
  var FILL_CHARS = "_.…";
  var DATE_JOINERS = "/-";
  var PRIORITY = {widget: 0, glyph: 1, square: 1, circle: 1, bracket: 1, comb: 2,
    fill: 3, label_space: 4, cell: 5, shaded: 6, underline: 7, blank: 8};
  var KIND_FR = {check: "case", text: "texte", any: "case ou texte"};
  var CTX_ORDER = ["row", "col", "left", "above", "right", "tooltip", "field_name"];
  var COLORS = {check: [0.95, 0.4, 0], text: [0, 0.35, 0.9], any: [0.55, 0, 0.7]};
  var TAG_COLOR = [0.8, 0, 0.4];

  function rect(x0, y0, x1, y1) {
    if (x1 < x0) { var tx = x0; x0 = x1; x1 = tx; }
    if (y1 < y0) { var ty = y0; y0 = y1; y1 = ty; }
    return {x0: x0, y0: y0, x1: x1, y1: y1};
  }
  function rw(r) { return r.x1 - r.x0; }
  function rh(r) { return r.y1 - r.y0; }
  function area(r) { return Math.max(rw(r), 0) * Math.max(rh(r), 0); }
  function empty(r) { return rw(r) <= 0 || rh(r) <= 0; }
  function contains(r, x, y) { return r.x0 <= x && x <= r.x1 && r.y0 <= y && y <= r.y1; }
  function intersection(a, b) {
    return {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)};
  }
  function expand(r, dx0, dy0, dx1, dy1) {
    return rect(r.x0 + dx0, r.y0 + dy0, r.x1 + dx1, r.y1 + dy1);
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function rlist(r) { return [round2(r.x0), round2(r.y0), round2(r.x1), round2(r.y1)]; }
  function clone(r) { return {x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}; }

  function widthFactor(ch) {
    if (ch === " " || ch === "\t" || ch === "\u00a0") return 0.33;
    if (ch === "_" || ch === "—" || ch === "–") return 0.5;
    if (ch === "." || ch === "," || ch === ":" || ch === ";" || ch === "'" || ch === "!" || ch === "|") return 0.28;
    if (ch === "i" || ch === "l" || ch === "I" || ch === "j" || ch === "f" || ch === "t" || ch === "r") return 0.33;
    if (ch === "-" || ch === "/" || ch === "\\" || ch === "(" || ch === ")" || ch === "[" || ch === "]") return 0.35;
    if (ch === "m" || ch === "w" || ch === "M" || ch === "W" || ch === "G" || ch === "@") return 0.85;
    if (BOX_GLYPHS.indexOf(ch) >= 0) return 0.9;
    return 0.56;
  }

  function luminance(rgb) {
    if (!rgb) return 1;
    return 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  }

  function multiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }
  function applyPoint(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  function pdfToDown(x, y, H) { return [x, H - y]; }

  function paintKind(op, OPS) {
    if (op === OPS.stroke || op === OPS.closeStroke) return "stroke";
    if (op === OPS.fill || op === OPS.eoFill) return "fill";
    if (op === OPS.fillStroke || op === OPS.eoFillStroke ||
        op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) return "both";
    return "";
  }

  function readVectors(fnArray, argsArray, OPS, H) {
    var hs = [], vs = [], rects = [], smalls = [], diagonals = [], images = [];
    var g = {ctm: [1, 0, 0, 1, 0, 0], fill: [0, 0, 0]};
    var stack = [];
    var pending = null;
    function paintPending(kind) {
      if (!pending || !kind) { pending = null; return; }
      var saved = g.ctm;
      g.ctm = pending.ctm;
      consume(pending.ops, pending.coords, kind);
      g.ctm = saved;
      pending = null;
    }

    function downPoint(x, y) {
      var p = applyPoint(g.ctm, x, y);
      return pdfToDown(p[0], p[1], H);
    }
    function downRect(x, y, w, h) {
      var pts = [downPoint(x, y), downPoint(x + w, y), downPoint(x, y + h), downPoint(x + w, y + h)];
      var x0 = pts[0][0], x1 = x0, y0 = pts[0][1], y1 = y0;
      for (var i = 1; i < 4; i++) {
        if (pts[i][0] < x0) x0 = pts[i][0];
        if (pts[i][0] > x1) x1 = pts[i][0];
        if (pts[i][1] < y0) y0 = pts[i][1];
        if (pts[i][1] > y1) y1 = pts[i][1];
      }
      return rect(x0, y0, x1, y1);
    }
    function pushHV(r, stroked, fill) {
      var w = rw(r), h = rh(r);
      if (h <= 1.8 && w > 1.8) hs.push([r.x0, r.x1, (r.y0 + r.y1) / 2]);
      else if (w <= 1.8 && h > 1.8) vs.push([(r.x0 + r.x1) / 2, r.y0, r.y1]);
      else if (5 <= w && w <= 16 && 5 <= h && h <= 16 && Math.abs(w - h) <= 2.5) {
        if (stroked || (fill && luminance(fill) > 0.35)) smalls.push(["square", r]);
      } else if (w > 1.8 && h > 1.8) {
        rects.push({rect: r, stroked: stroked, fill: fill});
        if (stroked) {
          hs.push([r.x0, r.x1, r.y0]); hs.push([r.x0, r.x1, r.y1]);
          vs.push([r.x0, r.y0, r.y1]); vs.push([r.x1, r.y0, r.y1]);
        }
      }
    }
    function pushLine(x0, y0, x1, y1) {
      var a = downPoint(x0, y0), b = downPoint(x1, y1);
      var dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
      if (dy < 1 && dx > 1.8) hs.push([Math.min(a[0], b[0]), Math.max(a[0], b[0]), (a[1] + b[1]) / 2]);
      else if (dx < 1 && dy > 1.8) vs.push([(a[0] + b[0]) / 2, Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
      else if (dx > 1.5 && dy > 1.5) diagonals.push(rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])));
    }
    function consume(pathOps, coords, kind) {
      var stroked = kind === "stroke" || kind === "both";
      var filled = kind === "fill" || kind === "both";
      var fill = filled ? g.fill.slice() : null;
      var ci = 0, cx = 0, cy = 0, sx = 0, sy = 0, pen = false;
      var sub = [], curves = 0;
      function flush() {
        if (!sub.length) { curves = 0; return; }
        var xs = sub.map(function (p) { return p[0]; });
        var ys = sub.map(function (p) { return p[1]; });
        var bb = downRect(Math.min.apply(null, xs), Math.min.apply(null, ys),
          Math.max.apply(null, xs) - Math.min.apply(null, xs),
          Math.max.apply(null, ys) - Math.min.apply(null, ys));
        var smallBox = rw(bb) >= 5 && rw(bb) <= 16 && rh(bb) >= 5 && rh(bb) <= 16 && Math.abs(rw(bb) - rh(bb)) <= 2.5;
        if (smallBox && (stroked || (fill && luminance(fill) > 0.35))) {
          smalls.push([curves ? "circle" : "square", bb]);
        } else if (curves && rw(bb) > 12 && rh(bb) > 6 && (stroked || fill)) {
          rects.push({rect: bb, stroked: stroked, fill: fill});
          if (stroked) {
            hs.push([bb.x0, bb.x1, bb.y0]); hs.push([bb.x0, bb.x1, bb.y1]);
            vs.push([bb.x0, bb.y0, bb.y1]); vs.push([bb.x1, bb.y0, bb.y1]);
          }
        }
        sub = []; curves = 0;
      }
      for (var p = 0; p < pathOps.length; p++) {
        var code = pathOps[p];
        if (code === OPS.rectangle) {
          flush();
          pushHV(downRect(coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]), stroked, fill);
          ci += 4;
        } else if (code === OPS.moveTo) {
          flush();
          cx = sx = coords[ci]; cy = sy = coords[ci + 1]; ci += 2;
          sub.push([cx, cy]); pen = true;
        } else if (code === OPS.lineTo) {
          var nx = coords[ci], ny = coords[ci + 1]; ci += 2;
          if (pen) pushLine(cx, cy, nx, ny);
          cx = nx; cy = ny; sub.push([cx, cy]); pen = true;
        } else if (code === OPS.curveTo) {
          curves++;
          sub.push([coords[ci], coords[ci + 1]], [coords[ci + 2], coords[ci + 3]], [coords[ci + 4], coords[ci + 5]]);
          cx = coords[ci + 4]; cy = coords[ci + 5]; ci += 6; pen = true;
        } else if (code === OPS.curveTo2 || code === OPS.curveTo3) {
          curves++;
          sub.push([coords[ci], coords[ci + 1]], [coords[ci + 2], coords[ci + 3]]);
          cx = coords[ci + 2]; cy = coords[ci + 3]; ci += 4; pen = true;
        } else if (code === OPS.closePath) {
          if (pen) pushLine(cx, cy, sx, sy);
          cx = sx; cy = sy; pen = false;
          flush();
        }
      }
      flush();
    }

    for (var i = 0; i < fnArray.length; i++) {
      var fn = fnArray[i];
      if (fn === OPS.save) stack.push({ctm: g.ctm.slice(), fill: g.fill.slice()});
      else if (fn === OPS.restore) g = stack.length ? stack.pop() : {ctm: [1, 0, 0, 1, 0, 0], fill: [0, 0, 0]};
      else if (fn === OPS.transform) g.ctm = multiply(g.ctm, argsArray[i]);
      else if (fn === OPS.setFillRGBColor) {
        var c = argsArray[i];
        g.fill = [c[0] / 255, c[1] / 255, c[2] / 255];
      } else if (fn === OPS.setFillGray) {
        var gy = argsArray[i][0];
        if (gy > 1) gy = gy / 255;
        g.fill = [gy, gy, gy];
      }       else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        images.push(downRect(0, 0, 1, 1));
      } else if (fn === OPS.constructPath) {
        var ops = argsArray[i][0], coords = argsArray[i][1];
        var startsNew = ops.length && (ops[0] === OPS.moveTo || ops[0] === OPS.rectangle);
        if (pending && !startsNew) {
          pending.ops = pending.ops.concat(ops);
          var merged = new Array(pending.coords.length + coords.length);
          for (var a = 0; a < pending.coords.length; a++) merged[a] = pending.coords[a];
          for (var b = 0; b < coords.length; b++) merged[pending.coords.length + b] = coords[b];
          pending.coords = merged;
        } else pending = {ops: ops, coords: coords, ctm: g.ctm.slice()};
      } else if (fn === OPS.clip || fn === OPS.eoClip || fn === OPS.endPath) {
        pending = null;
      } else {
        var kind = paintKind(fn, OPS);
        if (kind) paintPending(kind);
      }
    }
    return {
      hs: mergeCollinear(hs, true),
      vs: mergeCollinear(vs, false),
      rects: rects,
      smalls: smalls,
      diagonals: diagonals,
      images: images
    };
  }

  function mergeCollinear(segs, horizontal) {
    var gap = 4, tol = 0.8, norm = [], i;
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      norm.push(horizontal ? [s[2], s[0], s[1]] : [s[0], s[1], s[2]]);
    }
    norm.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [];
    for (i = 0; i < norm.length; i++) {
      var c = norm[i][0], a0 = norm[i][1], a1 = norm[i][2];
      var last = out.length ? out[out.length - 1] : null;
      if (last && Math.abs(last[0] - c) <= tol && a0 <= last[2] + gap && a1 >= last[1] - gap) {
        if (a0 < last[1]) last[1] = a0;
        if (a1 > last[2]) last[2] = a1;
      } else out.push([c, a0, a1]);
    }
    var merged = [];
    for (i = 0; i < out.length; i++) merged.push(horizontal ? [out[i][1], out[i][2], out[i][0]] : out[i]);
    return merged;
  }

  function clusterLines(segs, crossIdx, a0Idx, a1Idx) {
    var tol = 1.2, overlapPad = 2, n = segs.length;
    if (!n) return {coords: [], spansAt: {}};
    var parent = [], i;
    for (i = 0; i < n; i++) parent.push(i);
    function find(k) {
      while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
      return k;
    }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    var normed = [];
    for (i = 0; i < n; i++) {
      var seg = segs[i], c = seg[crossIdx], a0 = seg[a0Idx], a1 = seg[a1Idx];
      if (a0 > a1) { var tmp = a0; a0 = a1; a1 = tmp; }
      normed.push([c, a0, a1]);
    }
    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return normed[a][0] - normed[b][0]; });
    for (var ii = 0; ii < n; ii++) {
      var ia = order[ii], ci = normed[ia][0], a0i = normed[ia][1], a1i = normed[ia][2];
      for (var jj = ii + 1; jj < n; jj++) {
        var ib = order[jj], cj = normed[ib][0];
        if (cj - ci > tol) break;
        if (a0i <= normed[ib][2] + overlapPad && normed[ib][1] <= a1i + overlapPad) union(ia, ib);
      }
    }
    var groups = {};
    for (i = 0; i < n; i++) {
      var root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push(i);
    }
    var lines = [];
    for (var key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      var idxs = groups[key], num = 0, den = 0, spans = [];
      for (var q = 0; q < idxs.length; q++) {
        var part = normed[idxs[q]];
        var length = Math.max(part[2] - part[1], 0.01);
        num += part[0] * length; den += length;
        spans.push([part[1], part[2]]);
      }
      lines.push([num / den, spans]);
    }
    lines.sort(function (a, b) { return a[0] - b[0]; });
    var coords = [], spansAt = {};
    for (i = 0; i < lines.length; i++) { coords.push(lines[i][0]); spansAt[i] = lines[i][1]; }
    return {coords: coords, spansAt: spansAt};
  }

  function gridCells(hs, vs, pageWidth, pageHeight) {
    var v = clusterLines(vs, 0, 1, 2);
    var h = clusterLines(hs, 2, 0, 1);
    var xs = v.coords, ys = h.coords;
    if (xs.length < 2 || ys.length < 2) return [];
    function covered(spans, a, b) {
      for (var i = 0; i < spans.length; i++) if (spans[i][0] <= a + 2 && spans[i][1] >= b - 2) return true;
      return false;
    }
    var nx = xs.length - 1, ny = ys.length - 1, total = nx * ny, parent = [], p;
    for (p = 0; p < total; p++) parent.push(p);
    function find(k) {
      while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
      return k;
    }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    var j, i;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var k = j * nx + i;
      if (i + 1 < nx && !covered(v.spansAt[i + 1], ys[j], ys[j + 1])) union(k, k + 1);
      if (j + 1 < ny && !covered(h.spansAt[j + 1], xs[i], xs[i + 1])) union(k, k + nx);
    }
    var groups = {};
    for (p = 0; p < total; p++) {
      var root = find(p);
      if (!groups[root]) groups[root] = [];
      groups[root].push(p);
    }
    var pageArea = pageWidth * pageHeight, cells = [];
    for (var gk in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, gk)) continue;
      var ks = groups[gk], i0 = nx, i1 = -1, j0 = ny, j1 = -1, e;
      for (e = 0; e < ks.length; e++) {
        var col = ks[e] % nx, row = Math.floor(ks[e] / nx);
        if (col < i0) i0 = col; if (col > i1) i1 = col;
        if (row < j0) j0 = row; if (row > j1) j1 = row;
      }
      if (ks.length !== (i1 - i0 + 1) * (j1 - j0 + 1)) continue;
      var closed = true, rj, ci;
      for (rj = j0; rj <= j1; rj++) {
        if (!covered(v.spansAt[i0], ys[rj], ys[rj + 1]) || !covered(v.spansAt[i1 + 1], ys[rj], ys[rj + 1])) { closed = false; break; }
      }
      for (ci = i0; closed && ci <= i1; ci++) {
        if (!covered(h.spansAt[j0], xs[ci], xs[ci + 1]) || !covered(h.spansAt[j1 + 1], xs[ci], xs[ci + 1])) closed = false;
      }
      if (!closed) continue;
      var cell = rect(xs[i0], ys[j0], xs[i1 + 1], ys[j1 + 1]);
      if (rw(cell) < 6 || rh(cell) < 6 || area(cell) > 0.35 * pageArea) continue;
      cells.push(cell);
    }
    return cells;
  }

  // MuPDF ascender/descender for the base-14 fonts. pdf.js replaces them with a
  // generic sans (ascent 0.718) and drops the name unless the worker is patched.
  var BASE14 = {
    "Helvetica": [1.075, -0.299], "Helvetica-Bold": [1.07, -0.307],
    "Helvetica-Oblique": [1.07, -0.284], "Helvetica-BoldOblique": [1.073, -0.309],
    "Times-Roman": [1.053, -0.281], "Times-Bold": [1.044, -0.341],
    "Times-Italic": [0.951, -0.27], "Times-BoldItalic": [0.972, -0.324],
    "Courier": [0.932, -0.317], "Courier-Bold": [1.007, -0.393],
    "Courier-Oblique": [0.92, -0.317], "Courier-BoldOblique": [0.997, -0.393],
    "Symbol": [1.01, -0.293], "ZapfDingbats": [0.819, -0.144]
  };

  function fontMetrics(style) {
    style = style || {};
    var name = String(style.pdfName || "").replace(/^[A-Z]{6}\+/, "");
    var fromBbox = null;
    var bbox = style.bbox;
    if (bbox && bbox.length === 4 && Math.abs(bbox[3]) > 3) {
      var ascent = bbox[3] / 1000, descent = bbox[1] / 1000;
      if (ascent > 0.4 && ascent < 2.2 && descent > -1.5 && descent < 0.2) fromBbox = {ascent: ascent, descent: descent};
    }
    // 0.9052734375 is pdf.js's generic sans, used when the embedded font has no ascent.
    // The FontBBox is still the value PyMuPDF reports for those fonts.
    var genericSans = Math.abs((style.ascent || 0) - 0.9052734375) < 1e-6;
    if (genericSans && fromBbox) return fromBbox;
    if (BASE14[name] && !fromBbox) return {ascent: BASE14[name][0], descent: BASE14[name][1]};
    if (style.ascent) return {ascent: style.ascent, descent: style.descent == null ? -0.2 : style.descent};
    if (fromBbox) return fromBbox;
    return {ascent: 0.8, descent: -0.2};
  }

  function readText(textContent, H) {
    var styles = textContent.styles || {};
    var items = textContent.items || [];
    var lines = [];
    var current = null;
    function pushChar(line, ch) { line.push(ch); }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.str) continue;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var size = Math.hypot(tr[0], tr[1]) || it.height || 10;
      if (Math.abs(tr[1]) > 0.15 * size) continue;
      var style = styles[it.fontName] || {ascent: 0.8, descent: -0.2};
      var metrics = fontMetrics(style);
      var oy = H - tr[5];
      var bold = !!(style.bold) || /bold|black/i.test(style.pdfName || "") || /bold/i.test(style.fontFamily || "");
      var factors = [];
      var sum = 0;
      var s;
      for (s = 0; s < it.str.length; s++) {
        var f = widthFactor(it.str.charAt(s));
        factors.push(f); sum += f;
      }
      if (!sum) continue;
      var scale = it.width / sum;
      var x = tr[4];
      if (!current || Math.abs(current.oy - oy) > 2) {
        current = {oy: oy, chars: []};
        lines.push(current);
      }
      for (s = 0; s < it.str.length; s++) {
        var w = factors[s] * scale;
        var ch = it.str.charAt(s);
        var y0 = oy - metrics.ascent * size;
        var y1 = oy - metrics.descent * size;
        pushChar(current.chars, {c: ch, x0: x, y0: y0, x1: x + w, y1: y1, oy: oy, size: size, bold: bold});
        x += w;
      }
      if (it.hasEOL) current = null;
    }
    var out = [];
    for (var L = 0; L < lines.length; L++) {
      var chars = lines[L].chars.slice().sort(function (a, b) { return a.x0 - b.x0; });
      if (chars.length) out.push(chars);
    }
    return out;
  }

  function word(chars, box) {
    var text = "", i;
    for (i = 0; i < chars.length; i++) text += chars[i].c;
    var x0 = chars[0].x0, x1 = chars[0].x1, y0 = chars[0].y0, y1 = chars[0].y1;
    for (i = 1; i < chars.length; i++) {
      if (chars[i].x0 < x0) x0 = chars[i].x0;
      if (chars[i].x1 > x1) x1 = chars[i].x1;
      if (chars[i].y0 < y0) y0 = chars[i].y0;
      if (chars[i].y1 > y1) y1 = chars[i].y1;
    }
    var size = chars[0].size;
    return {
      text: text, x0: x0, y0: y0, x1: x1, y1: y1, oy: chars[0].oy, size: size,
      bold: chars[0].bold, is_box: !!box,
      cx: (x0 + x1) / 2,
      cy: chars[0].oy - 0.35 * size,
      filler: text.length >= 3 && text.split("").every(function (c) {
        return FILL_CHARS.indexOf(c) >= 0 || DATE_JOINERS.indexOf(c) >= 0;
      })
    };
  }

  function wordsOf(lines) {
    var words = [];
    for (var L = 0; L < lines.length; L++) {
      var chars = lines[L], cur = [], prev = null, i;
      for (i = 0; i < chars.length; i++) {
        var c = chars[i], ch = c.c;
        var gap = prev && c.x0 - prev.x1 > 0.35 * c.size;
        if (ch === " " || ch === "\t" || ch === "\u00a0" || BOX_GLYPHS.indexOf(ch) >= 0 || gap || (prev && BOX_GLYPHS.indexOf(prev.c) >= 0)) {
          if (cur.length) words.push(word(cur));
          cur = [];
        }
        if (BOX_GLYPHS.indexOf(ch) >= 0) words.push(word([c], true));
        else if (ch !== " " && ch !== "\t" && ch !== "\u00a0") cur.push(c);
        prev = c;
      }
      if (cur.length) words.push(word(cur));
    }
    return words;
  }

  function textOf(words) {
    return words.map(function (w) { return w.text; }).join(" ").trim();
  }

  function median(values) {
    if (!values.length) return 10;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    if (s.length % 2) return s[mid];
    return (s[mid - 1] + s[mid]) / 2;
  }

  function inside(w, r, pad) {
    if (pad === undefined) pad = 0.5;
    var mid = (w.y0 + w.y1) / 2;
    return r.x0 - pad <= w.cx && w.cx <= r.x1 + pad && r.y0 - pad <= mid && mid <= r.y1 + pad;
  }
  function vOverlap(a, b) { return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); }

  function charRuns(lines) {
    var fills = [], brackets = [];
    for (var L = 0; L < lines.length; L++) {
      var chars = lines[L], n = chars.length, i = 0;
      while (i < n) {
        var c = chars[i].c;
        if (FILL_CHARS.indexOf(c) >= 0) {
          var j = i;
          while (j + 1 < n && chars[j + 1].x0 - chars[j].x1 < 0.6 * chars[j].size &&
              (FILL_CHARS.indexOf(chars[j + 1].c) >= 0 ||
               (DATE_JOINERS.indexOf(chars[j + 1].c) >= 0 && j + 2 < n && FILL_CHARS.indexOf(chars[j + 2].c) >= 0))) j++;
          var run = chars.slice(i, j + 1);
          var unders = 0, dots = 0, k;
          for (k = 0; k < run.length; k++) {
            if (run[k].c === "_") unders++;
            if (run[k].c === ".") dots++;
            if (run[k].c === "…") dots += 3;
          }
          if (unders >= 3 || dots >= 5) {
            var size = 0, oy = run[0].oy;
            for (k = 0; k < run.length; k++) if (run[k].size > size) size = run[k].size;
            fills.push({rect: rect(run[0].x0, oy - 1.05 * size, run[run.length - 1].x1, oy + 1), size: size, oy: oy});
          }
          i = j + 1;
          continue;
        }
        if (c === "[" || c === "(") {
          var close = c === "[" ? "]" : ")";
          j = i + 1;
          var inner = [];
          while (j < n && chars[j].c !== close && j - i <= 6) { inner.push(chars[j].c); j++; }
          if (j < n && chars[j].c === close) {
            var content = inner.join("").trim();
            var gap = chars[j].x0 - chars[i].x1;
            var width = chars[j].x1 - chars[i].x0;
            var blank = (inner.length && !content) || (!inner.length && gap >= 3);
            var ticked = CHECK_GLYPHS.indexOf(content) >= 0 && content.length === 1;
            if ((blank || ticked) && width >= 4 && width <= 30) {
              brackets.push({
                rect: rect(chars[i].x0, Math.min(chars[i].y0, chars[j].y0), chars[j].x1, Math.max(chars[i].y1, chars[j].y1)),
                checked: ticked
              });
              i = j + 1;
              continue;
            }
          }
        }
        i++;
      }
    }
    return {fills: fills, brackets: brackets};
  }

  function gridNeighbor(cell, cells, dir) {
    var best = null, bestGap = null, i;
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c === cell) continue;
      var gap;
      if (dir > 0) {
        if (c.x0 < cell.x1 - 2) continue;
        gap = c.x0 - cell.x1;
      } else {
        if (cell.x0 < c.x1 - 2) continue;
        gap = cell.x0 - c.x1;
      }
      if (gap > 8) continue;
      if (vOverlap(cell, c) < 0.55 * Math.min(rh(cell), rh(c))) continue;
      if (best === null || gap < bestGap - 0.5 || (Math.abs(gap - bestGap) <= 0.5 && c.y0 < best.y0)) {
        best = c; bestGap = gap;
      }
    }
    return best;
  }

  function columnTitleAbove(cell, cells, wordsIn) {
    var above = null, bestGap = null, i;
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (Math.abs(c.x0 - cell.x0) > 8 || Math.abs(c.x1 - cell.x1) > 8) continue;
      var gap = cell.y0 - c.y1;
      if (gap < -1 || gap > 36) continue;
      if (above === null || gap < bestGap) { above = c; bestGap = gap; }
    }
    if (!above) return false;
    var title = textOf(wordsIn(above)).trim();
    if (!title || title.charAt(title.length - 1) === ":") return false;
    var left = gridNeighbor(above, cells, -1);
    if (left) {
      var leftTxt = textOf(wordsIn(left)).trim();
      if (leftTxt.charAt(leftTxt.length - 1) === ":") return false;
    }
    return true;
  }

  function dropColonResidues(cands, cells, wordsIn) {
    var drop = [];
    var residues = cands.filter(function (z) { return z.colon_residue && z.parent_cell; });
    residues.forEach(function (z) {
      var parent = z.parent_cell;
      var sib = gridNeighbor(parent, cells, 1);
      if (!sib) return;
      var ws = wordsIn(sib);
      if (!ws.length) {
        if (columnTitleAbove(sib, cells, wordsIn)) return;
        drop.push(z);
        return;
      }
      ws.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
      var oy = ws[ws.length - 1].oy;
      var lastLine = ws.filter(function (w) { return Math.abs(w.oy - oy) <= 2.5; });
      var label = textOf(lastLine.slice().sort(function (a, b) { return a.x0 - b.x0; }));
      if (label.charAt(label.length - 1) !== ":") return;
      var lx1 = Math.max.apply(null, lastLine.map(function (w) { return w.x1; }));
      var rightGap = sib.x1 - lx1;
      if (rightGap < 30) return;
      var leftShare = rw(z.rect) / Math.max(rw(parent), 1);
      if (leftShare <= 0.65 && rw(z.rect) < 0.85 * rightGap) drop.push(z);
    });
    return cands.filter(function (z) {
      if (drop.indexOf(z) >= 0) return false;
      delete z.colon_residue;
      delete z.parent_cell;
      return true;
    });
  }

  function boxFromGlyph(w) {
    var side = Math.min(w.x1 - w.x0, 0.75 * w.size);
    return rect(w.cx - side / 2, w.oy - side, w.cx + side / 2, w.oy);
  }

  function zone(shape, kind, r, extra) {
    var z = {shape: shape, kind: kind, rect: clone(r)};
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) z[k] = extra[k];
    return z;
  }

  function dedupe(cands) {
    cands.sort(function (a, b) {
      return PRIORITY[a.shape] - PRIORITY[b.shape] || a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0;
    });
    var kept = [];
    for (var i = 0; i < cands.length; i++) {
      var z = cands[i], r = z.rect, a = Math.max(area(r), 0.01), clash = false;
      for (var k = 0; k < kept.length; k++) {
        var inter = intersection(r, kept[k].rect);
        if (empty(inter)) continue;
        var ia = rw(inter) * rh(inter);
        var karea = Math.max(area(kept[k].rect), 0.01);
        if (ia > 0.3 * Math.min(a, karea)) { clash = true; break; }
      }
      if (!clash) kept.push(z);
    }
    return kept;
  }

  function mergeContinuations(zones, words) {
    var lines = zones.filter(function (z) { return z.shape === "fill" || z.shape === "underline"; });
    lines.sort(function (a, b) { return a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0; });
    var absorbed = [];
    for (var i = 0; i < lines.length; i++) {
      var a = lines[i];
      if (absorbed.indexOf(a) >= 0) continue;
      var last = a.rect;
      for (var j = i + 1; j < lines.length; j++) {
        var b = lines[j], r = b.rect;
        if (absorbed.indexOf(b) >= 0 || Math.abs(r.x1 - last.x1) > 20 || !(0 < r.y1 - last.y1 && r.y1 - last.y1 <= 2.6 * Math.max(rh(last), 8))) continue;
        var bandWords = words.filter(function (w) {
          return r.y0 - 2 <= w.cy && w.cy <= r.y1 + 2 && w.x1 <= r.x0 + 1 && r.x0 - w.x1 < 200 && !w.filler;
        });
        if (bandWords.length) continue;
        if (!a.extra) a.extra = [];
        a.extra.push(clone(r));
        absorbed.push(b);
        last = r;
      }
    }
    return zones.filter(function (z) { return absorbed.indexOf(z) < 0; });
  }

  function phrase(words, start, direction, limit, stopRects) {
    var out = [start];
    var pool = words.slice().sort(function (a, b) { return direction < 0 ? b.x0 - a.x0 : a.x0 - b.x0; });
    for (var i = 0; i < pool.length; i++) {
      var w = pool[i];
      if (w === start || out.indexOf(w) >= 0) continue;
      var edge = out[out.length - 1];
      var gap = direction < 0 ? edge.x0 - w.x1 : w.x0 - edge.x1;
      if (gap < -1) continue;
      if (gap > 2.2 * Math.max(w.size, edge.size)) break;
      var lo = direction < 0 ? w.x1 : edge.x1;
      var hi = direction < 0 ? edge.x0 : w.x0;
      var blocked = stopRects.some(function (s) {
        var mx = (s.x0 + s.x1) / 2;
        return lo - 1 < mx && mx < hi + 1;
      });
      if (blocked) break;
      out.push(w);
      var len = 0;
      for (var k = 0; k < out.length; k++) len += out[k].text.length + 1;
      if (len > limit) break;
    }
    if (direction < 0) out.reverse();
    return textOf(out);
  }

  function addContext(zones, words, cells) {
    var rects = zones.map(function (z) { return z.rect; });
    var free = words.filter(function (w) {
      return !w.filler && !rects.some(function (r) { return inside(w, r, 0.2); });
    });
    zones.forEach(function (z) {
      var r = z.rect;
      var cy = (r.y0 + r.y1) / 2;
      var band = rh(r) <= 20 ? [cy - 5, cy + 5] : [r.y0, Math.min(r.y1, r.y0 + 16)];
      var same = free.filter(function (w) { return band[0] - 1 <= w.cy && w.cy <= band[1] + 1; });
      var others = rects.filter(function (o) { return o !== r && o.y0 - 2 <= cy && cy <= o.y1 + 2; });
      var ctx = {};
      var left = same.filter(function (w) { return w.x1 <= r.x0 + 1 && r.x0 - w.x1 <= 250; });
      if (left.length) ctx.left = phrase(left, left.reduce(function (a, b) { return a.x1 > b.x1 ? a : b; }), -1, 90, others);
      var right = same.filter(function (w) { return w.x0 >= r.x1 - 1 && w.x0 - r.x1 <= (z.kind === "check" ? 25 : 12); });
      if (right.length) {
        var rightPool = right.concat(same.filter(function (w) { return w.x0 > r.x1; }));
        ctx.right = phrase(rightPool, right.reduce(function (a, b) { return a.x0 < b.x0 ? a : b; }), 1, 70, others);
      }
      var above = free.filter(function (w) {
        return w.y1 <= r.y0 + 1 && r.y0 - w.y1 <= 24 && w.x1 > r.x0 - 4 && w.x0 < r.x1 + 4;
      });
      if (above.length) {
        var ly = Math.max.apply(null, above.map(function (w) { return w.oy; }));
        ctx.above = textOf(above.filter(function (w) { return Math.abs(w.oy - ly) <= 2.5; }).sort(function (a, b) { return a.x0 - b.x0; })).slice(0, 90);
      }
      var line = free.filter(function (w) { return band[0] - 1 <= w.cy && w.cy <= band[1] + 1; }).sort(function (a, b) { return a.x0 - b.x0; });
      if (line.length) ctx.line = textOf(line).slice(0, 160);
      var cell = null, bestA = Infinity;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (contains(c, r.x0 + rw(r) / 2, cy)) {
          var a = area(c);
          if (a < bestA) { bestA = a; cell = c; }
        }
      }
      if (cell) {
        var row = free.filter(function (w) {
          return cell.y0 - 1 <= w.cy && w.cy <= cell.y1 + 1 && w.x1 <= cell.x0 + 1 && cell.x0 - w.x1 <= 450;
        }).sort(function (a, b) { return Math.round(a.oy / 3) - Math.round(b.oy / 3) || a.x0 - b.x0; });
        if (row.length) ctx.row = textOf(row).slice(0, 110);
      }
      if (cell || z.kind !== "text") {
        var span = cell && rw(cell) < 3 * Math.max(rw(r), 12) ? cell : r;
        var cx = (span.x0 + span.x1) / 2;
        var top = r.y0;
        function xHit(w) { return w.x0 - 2 <= cx && cx <= w.x1 + 2 || span.x0 - 1 <= w.cx && w.cx <= span.x1 + 1; }
        function isAbove(w) { return w.oy <= top + 2 || w.y1 <= top + 2; }
        var near = free.filter(function (w) { return isAbove(w) && top - w.y1 <= 100 && xHit(w); });
        var far = free.filter(function (w) { return isAbove(w) && top - w.y1 > 100 && top - w.y1 <= 420 && xHit(w) && w.text.length <= 12; });
        var colWords = near.length ? near : far;
        if (colWords.length) {
          var nearest = colWords.reduce(function (best, w) {
            var score = Math.max(0, top - w.y1) + (w.text.length <= 12 ? 0 : 25);
            var bscore = Math.max(0, top - best.y1) + (best.text.length <= 12 ? 0 : 25);
            if (score < bscore - 0.01) return w;
            if (Math.abs(score - bscore) <= 0.01 && w.y1 > best.y1) return w;
            return best;
          });
          var hcell = null, hbest = Infinity;
          for (var hi = 0; hi < cells.length; hi++) {
            var hc = cells[hi];
            if (contains(hc, nearest.cx, (nearest.y0 + nearest.y1) / 2)) {
              var ha = area(hc);
              if (ha < hbest) { hbest = ha; hcell = hc; }
            }
          }
          var text;
          if (hcell && rw(hcell) < 4 * Math.max(rw(span), 20) && rh(hcell) < 40) {
            text = textOf(free.filter(function (w) { return inside(w, hcell); }).sort(function (a, b) { return Math.round(a.oy) - Math.round(b.oy) || a.x0 - b.x0; }));
          } else {
            var sameLine = free.filter(function (w) { return Math.abs(w.oy - nearest.oy) <= 2.5; });
            var leftTxt = phrase(sameLine, nearest, -1, 40, []);
            var rightTxt = phrase(sameLine, nearest, 1, 40, []);
            var prefix = leftTxt.slice(-nearest.text.length) === nearest.text ? leftTxt.slice(0, -nearest.text.length).replace(/\s+$/, "") : leftTxt;
            text = [prefix, rightTxt].filter(Boolean).join(" ").trim();
          }
          text = text.replace(/\s+/g, " ").slice(0, 80);
          if (text) ctx.col = text;
        }
      }
      z.ctx = ctx;
    });
    propagateCol(zones);
  }

  function propagateCol(zones) {
    var checks = zones.filter(function (z) { return (z.kind === "check" || z.kind === "any") && z.page; });
    checks.sort(function (a, b) {
      return a.page - b.page || ((a.rect.x0 + a.rect.x1) / 2) - ((b.rect.x0 + b.rect.x1) / 2) || a.rect.y0 - b.rect.y0;
    });
    var i = 0;
    while (i < checks.length) {
      var j = i + 1;
      var cx = (checks[i].rect.x0 + checks[i].rect.x1) / 2;
      while (j < checks.length && checks[j].page === checks[i].page &&
          Math.abs((checks[j].rect.x0 + checks[j].rect.x1) / 2 - cx) <= 4) j++;
      var col = null;
      for (var k = i; k < j; k++) if (checks[k].ctx && checks[k].ctx.col) { col = checks[k].ctx.col; break; }
      if (col) for (k = i; k < j; k++) if (!checks[k].ctx.col) checks[k].ctx.col = col;
      i = j;
    }
  }

  function detectPage(model, pno) {
    var lines = model.lines;
    var words = wordsOf(lines);
    var textWords = words.filter(function (w) { return !w.is_box; });
    var hs = model.hs, vs = model.vs, rects = model.rects, smalls = model.smalls, diagonals = model.diagonals;
    var pageRect = rect(0, 0, model.width, model.height);
    var cells = gridCells(hs, vs, model.width, model.height);
    var med = median(textWords.map(function (w) { return w.size; }));
    var cands = [];
    function ticked(r) {
      var grown = expand(r, -3, -4, 3, 4);
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!w.is_box && w.text.length === 1 && CHECK_GLYPHS.indexOf(w.text) >= 0 && inside(w, grown)) return true;
      }
      var n = 0;
      for (i = 0; i < diagonals.length; i++) {
        var d = diagonals[i];
        if (contains(r, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2)) n++;
      }
      return n >= 2;
    }
    words.forEach(function (w) {
      if (!w.is_box) return;
      var r = boxFromGlyph(w);
      cands.push(zone("glyph", "check", r, {checked: "☑☒".indexOf(w.text) >= 0 || ticked(r)}));
    });
    smalls.forEach(function (s) {
      cands.push(zone(s[0], "check", s[1], {checked: ticked(s[1])}));
    });
    var runs = charRuns(lines);
    runs.brackets.forEach(function (b) { cands.push(zone("bracket", "check", b.rect, {checked: b.checked})); });
    runs.fills.forEach(function (f) { cands.push(zone("fill", "text", f.rect)); });

    function wordsIn(r) {
      return textWords.filter(function (w) { return inside(w, r) && !w.filler; });
    }
    function hasImage(r) {
      return model.images.some(function (im) {
        var inter = intersection(r, im);
        return !empty(inter) && area(inter) > 0.3 * area(r);
      });
    }
    var combCells = [];
    cells.forEach(function (c) {
      var inner = rect(c.x0 + 1.5, c.y0 + 1, c.x1 - 1.5, c.y1 - 1);
      var ws = wordsIn(c);
      var boxInside = words.some(function (w) { return w.is_box && inside(w, c); });
      if (boxInside || hasImage(c)) return;
      if (!ws.length) {
        if (rw(c) <= 22 && rh(c) <= 28) combCells.push(c);
        var kind = rw(c) <= 60 && rh(c) <= 30 ? "any" : "text";
        cands.push(zone("cell", kind, inner));
        return;
      }
      ws.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
      var lastOy = ws[ws.length - 1].oy;
      var lastLine = ws.filter(function (w) { return Math.abs(w.oy - lastOy) <= 2.5; });
      var top = Math.min.apply(null, ws.map(function (w) { return w.y0; }));
      var bottom = Math.max.apply(null, ws.map(function (w) { return w.y1; }));
      var lx1 = Math.max.apply(null, lastLine.map(function (w) { return w.x1; }));
      var smallOrBold = ws.every(function (w) { return w.bold; }) || Math.max.apply(null, ws.map(function (w) { return w.size; })) > 1.25 * med;
      var label = textOf(lastLine.slice().sort(function (a, b) { return a.x0 - b.x0; }));
      if (label.charAt(label.length - 1) === ":" && c.x1 - lx1 >= 30 && !smallOrBold) {
        var oys = {};
        ws.forEach(function (w) { oys[Math.round(w.oy)] = 1; });
        var sameTop = Math.min.apply(null, lastLine.map(function (w) { return w.y0; }));
        var y0 = Object.keys(oys).length === 1 ? c.y0 + 1 : sameTop - 1;
        cands.push(zone("label_space", "text", rect(lx1 + 3, y0, c.x1 - 1.5, c.y1 - 1), {colon_residue: true, parent_cell: c}));
      } else if (top - c.y0 < 7 && c.y1 - bottom >= 12 && rh(c) >= 22) {
        cands.push(zone("label_space", "text", rect(c.x0 + 1.5, bottom + 1, c.x1 - 1.5, c.y1 - 1)));
      }
    });
    cands = dropColonResidues(cands, cells, wordsIn);

    var combSrc = combCells.concat(smalls.filter(function (s) { return s[0] === "square"; }).map(function (s) { return s[1]; }));
    combSrc.sort(function (a, b) { return Math.round(a.y0) - Math.round(b.y0) || a.x0 - b.x0; });
    var groups = [];
    combSrc.forEach(function (r) {
      var g = groups.length ? groups[groups.length - 1] : null;
      var prev = g ? g[g.length - 1] : null;
      if (prev && Math.abs(prev.y0 - r.y0) <= 1.2 && Math.abs(prev.y1 - r.y1) <= 1.2 && r.x0 - prev.x1 >= 0 && r.x0 - prev.x1 <= 1.5) g.push(r);
      else groups.push([r]);
    });
    groups = groups.filter(function (g) { return g.length >= 2; });
    var merged = [];
    groups.forEach(function (g) {
      var p = merged.length ? merged[merged.length - 1] : null;
      if (p && Math.abs(p[p.length - 1].y0 - g[0].y0) <= 1.2 && g[0].x0 - p[p.length - 1].x1 > 0 && g[0].x0 - p[p.length - 1].x1 <= 16) {
        var gapR = rect(p[p.length - 1].x1, g[0].y0, g[0].x0, g[0].y1);
        var ok = textWords.filter(function (w) { return inside(w, gapR); }).every(function (w) { return "/-.".indexOf(w.text) >= 0; });
        if (ok) { p.push.apply(p, g); return; }
      }
      merged.push(g.slice());
    });
    merged.forEach(function (g) {
      var heads = 0;
      g.forEach(function (r) {
        if (textWords.some(function (w) { return r.x0 <= w.cx && w.cx <= r.x1 && r.y0 - 25 <= w.y1 && w.y1 <= r.y0 + 1; })) heads++;
      });
      if (heads > g.length / 2) return;
      var box = rect(g[0].x0, Math.min.apply(null, g.map(function (r) { return r.y0; })), g[g.length - 1].x1, Math.max.apply(null, g.map(function (r) { return r.y1; })));
      cands.push(zone("comb", "text", box, {cells: g.map(rlist)}));
    });

    var pageArea = model.width * model.height;
    rects.forEach(function (d) {
      var r = d.rect;
      if (d.stroked || !d.fill) return;
      var lum = luminance(d.fill);
      if (lum < 0.55 || lum > 0.975 || rh(r) < 8 || rh(r) > 60 || rw(r) < 25) return;
      if (area(r) > 0.25 * pageArea || wordsIn(r).length || hasImage(r)) return;
      cands.push(zone("shaded", "text", rect(r.x0 + 1.5, r.y0 + 1, r.x1 - 1.5, r.y1 - 1)));
    });

    function verticalNear(x, y) {
      return vs.some(function (v) { return Math.abs(v[0] - x) <= 4 && v[1] - 4 <= y && y <= v[2] + 4; });
    }
    hs.forEach(function (seg) {
      var x0 = seg[0], x1 = seg[1], y = seg[2], length = x1 - x0;
      if (length < 25 || length > 0.85 * model.width) return;
      if (verticalNear(x0, y) || verticalNear(x1, y)) return;
      var above = textWords.filter(function (w) { return w.y1 <= y - 1 && w.x1 > x0 && w.x0 < x1 && y - w.y1 < 30; });
      var y0 = y - 14;
      above.forEach(function (w) {
        if (!(y - 13 <= w.y1 && w.y1 <= y + 1) && w.y1 + 0.5 > y0) y0 = w.y1 + 0.5;
      });
      var zrect = rect(x0 + 1, y0, x1 - 1, y - 0.6);
      var insideWords = textWords.filter(function (w) { return inside(w, zrect) && !w.filler; });
      if (insideWords.length) {
        var span = Math.max.apply(null, insideWords.map(function (w) { return w.x1; })) - Math.min.apply(null, insideWords.map(function (w) { return w.x0; }));
        if (span >= 0.85 * length || length > 0.6 * model.width) return;
      }
      cands.push(zone("underline", "text", zrect));
    });

    // pdf.js glues every run on the same baseline into one line. Python's rawdict
    // lines stay separate, so "Label:" and the words 80pt to its right are two lines
    // and the first one ends with the colon. Split a baseline where a gap is wider
    // than a space before applying that rule.
    function textRuns(chars) {
      var sorted = chars.slice().sort(function (a, b) { return a.x0 - b.x0; });
      var runs = [], run = [];
      for (var i = 0; i < sorted.length; i++) {
        var ch = sorted[i];
        var prev = run.length ? run[run.length - 1] : null;
        var wide = Math.max(8, 1.5 * (ch.size || 10));
        // pdf.js turns the gap between two text objects into one very wide space.
        if ((ch.c === " " || ch.c === "\u00a0") && ch.x1 - ch.x0 > wide) {
          if (run.length) runs.push(run);
          run = [];
          continue;
        }
        if (prev && ch.x0 - prev.x1 > wide) {
          runs.push(run);
          run = [ch];
        } else run.push(ch);
      }
      if (run.length) runs.push(run);
      return runs;
    }
    lines.forEach(function (chars) {
      textRuns(chars).forEach(function (run) {
        var lw = wordsOf([run]);
        if (!lw.length || lw[lw.length - 1].is_box) return;
        var last = lw[lw.length - 1];
        if (last.text.charAt(last.text.length - 1) !== ":" || last.bold || last.size > 1.15 * med || textOf(lw).length > 80) return;
        var nxt = textWords.filter(function (w) { return Math.abs(w.oy - last.oy) <= 2.5 && w.x0 > last.x1 + 1; }).map(function (w) { return w.x0; });
        var x1 = nxt.length ? Math.min.apply(null, nxt) - 4 : pageRect.x1 - 36;
        if (x1 - last.x1 >= 60) cands.push(zone("blank", "text", rect(last.x1 + 4, last.y0 - 1, x1, last.y1 + 1)));
      });
    });

    var zones = mergeContinuations(dedupe(cands), textWords);
    zones.forEach(function (z) {
      if (z.kind !== "check") {
        var pre = textWords.filter(function (w) { return inside(w, z.rect) && !w.filler; });
        if (z.cells) pre = pre.filter(function (w) { return /[0-9A-Za-z]/.test(w.text); });
        pre.sort(function (a, b) { return Math.round(a.oy) - Math.round(b.oy) || a.x0 - b.x0; });
        z.prefilled = textOf(pre) || null;
      }
      z.page = pno;
    });
    addContext(zones, textWords, cells);
    model.words = words;
    return zones;
  }

  function acroformZones(annots, lines, H, pno) {
    var words = wordsOf(lines).filter(function (w) { return !w.is_box; });
    var zones = [];
    (annots || []).forEach(function (a) {
      if (a.subtype !== "Widget") return;
      var ft = a.fieldType;
      if (ft === "Sig") return;
      var push = a.pushButton || a.fieldType === "Btn" && !a.checkBox && !a.radioButton;
      if (push) return;
      var box = a.rect || [0, 0, 0, 0];
      var r = rect(box[0], H - box[3], box[2], H - box[1]);
      var isCheck = !!(a.checkBox || a.radioButton);
      var z = zone("widget", isCheck ? "check" : "text", r, {field_name: a.fieldName || ""});
      var xref = parseInt(a.id, 10);
      if (xref) z.xref = xref;
      if (a.radioButton && a.exportValue) z.export_value = a.exportValue;
      if (isCheck) z.checked = !!(a.fieldValue && a.fieldValue !== "Off");
      else {
        z.prefilled = (a.fieldValue || "").trim() || null;
        if (ft === "Ch" && a.options) z.choices = a.options.map(function (c) { return typeof c === "string" ? c : c.displayValue || c.exportValue || ""; });
      }
      z.page = pno;
      if (a.alternativeText) z.tooltip = a.alternativeText;
      zones.push(z);
    });
    addContext(zones, words, []);
    zones.forEach(function (z) {
      if (z.tooltip) { z.ctx.tooltip = z.tooltip; delete z.tooltip; }
      z.ctx.field_name = z.field_name;
      delete z.field_name;
    });
    return zones;
  }

  function finalize(zones) {
    zones.forEach(function (z) {
      z.rect = rlist(z.rect);
      if (z.extra) z.extra = z.extra.map(function (r) { return rlist(r); });
    });
    return zones;
  }

  async function detectPdf(bytes, pdfjsLib) {
    var doc = await pdfjsLib.getDocument({data: bytes.slice(0), disableFontFace: true, verbosity: 0}).promise;
    var zones = [], notes = [];
    for (var pno = 1; pno <= doc.numPages; pno++) {
      var page = await doc.getPage(pno);
      var view = page.getViewport({scale: 1});
      var H = view.height, W = view.width;
      if (page.rotate) notes.push("page " + pno + " : rotation " + page.rotate + "°, positions à vérifier");
      var text = await page.getTextContent();
      var ops = await page.getOperatorList();
      var annots = await page.getAnnotations({intent: "display"});
      var lines = readText(text, H);
      var vectors = readVectors(ops.fnArray, ops.argsArray, pdfjsLib.OPS, H);
      var plain = text.items.map(function (it) { return it.str || ""; }).join("").trim();
      var model = {
        width: W, height: H, lines: lines,
        hs: vectors.hs, vs: vectors.vs, rects: vectors.rects, smalls: vectors.smalls,
        diagonals: vectors.diagonals, images: vectors.images
      };
      var widgets = acroformZones(annots, lines, H, pno);
      var flat = detectPage(model, pno);
      if (widgets.length) {
        flat = flat.filter(function (z) {
          return !widgets.some(function (w) {
            var inter = intersection(z.rect, w.rect);
            return !empty(inter) && area(inter) > 0.3 * area(z.rect);
          });
        });
      }
      if (!plain && vectors.images.length) notes.push("page " + pno + " : page scannée (image sans texte), aucune zone détectable");
      var pageZones = widgets.concat(flat);
      pageZones.sort(function (a, b) { return Math.round(a.rect.y0 / 3) - Math.round(b.rect.y0 / 3) || a.rect.x0 - b.rect.x0; });
      zones = zones.concat(pageZones);
    }
    var pageCount = doc.numPages;
    await doc.destroy();
    finalize(zones);
    var kind = zones.some(function (z) { return z.shape === "widget"; }) ? "pdf_acroform" : "pdf_flat";
    return {kind: kind, pages: pageCount, zones: zones, notes: notes, detector: DETECTOR_VERSION};
  }

  function zoneLine(z) {
    var bits = [z.id, z.page ? "p" + z.page : "", KIND_FR[z.kind]];
    var ctx = z.ctx || {};
    CTX_ORDER.forEach(function (k) { if (ctx[k]) bits.push(k + ': "' + ctx[k] + '"'); });
    if (z.cells) bits.push("peigne " + z.cells.length + " cases");
    if (z.extra) bits.push((z.extra.length + 1) + " lignes");
    if (z.max_length) bits.push("max " + z.max_length + " car.");
    if (z.choices) bits.push("valeurs possibles: " + z.choices.slice(0, 12).join(" / "));
    if (z.checked) bits.push("DÉJÀ COCHÉE");
    if (z.prefilled) bits.push('DÉJÀ REMPLIE: "' + String(z.prefilled).slice(0, 60) + '"');
    return bits.filter(Boolean).join(" | ");
  }

  function zonesTxt(zmap) {
    var counts = {check: 0, text: 0, any: 0};
    zmap.zones.forEach(function (z) { counts[z.kind] = (counts[z.kind] || 0) + 1; });
    var head = [
      "ZONE_MAP " + zmap.map_id,
      "Formulaire : " + zmap.source + " (" + (zmap.pages || "?") + " pages)",
      zmap.zones.length + " zones : " + (counts.check || 0) + " cases, " + (counts.text || 0) + " textes, " + (counts.any || 0) + " cellules case-ou-texte",
      "Format : id | page | type | texte autour (row = début de la ligne du tableau, col = en-tête de colonne,",
      "left / right / above = texte à gauche / à droite / au-dessus)."
    ];
    (zmap.notes || []).forEach(function (n) { head.push("Note : " + n); });
    return head.concat([""]).concat(zmap.zones.map(zoneLine)).join("\n") + "\n";
  }

  async function mapId(bytes) {
    var data = new Uint8Array(bytes.byteLength + DETECTOR_VERSION.length);
    data.set(bytes, 0);
    for (var i = 0; i < DETECTOR_VERSION.length; i++) data[bytes.byteLength + i] = DETECTOR_VERSION.charCodeAt(i);
    var subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
    if (!subtle && typeof require === "function") {
      var nodeCrypto = require("crypto");
      return nodeCrypto.createHash("sha256").update(Buffer.from(data)).digest("hex").slice(0, 8);
    }
    var digest = await subtle.digest("SHA-256", data);
    var hex = [];
    new Uint8Array(digest).forEach(function (b) { hex.push((b < 16 ? "0" : "") + b.toString(16)); });
    return hex.join("").slice(0, 8);
  }

  function tagSpots(z, w, fs) {
    var r = z.rect;
    var mid = (r.y0 + r.y1) / 2 + fs * 0.35;
    var left = [r.x0 - w - 1.5, mid], right = [r.x1 + 1.5, mid];
    var above = [r.x0, r.y0 - 1], below = [r.x0, r.y1 + fs * 0.8 + 0.5];
    if (z.kind === "check") return [left, right, above, below];
    var insideY = rh(r) >= fs + 1 ? r.y0 + fs * 0.9 + 0.5 : r.y1 - 1;
    return [[r.x0 + 1, insideY], [r.x1 - w - 1, insideY], above, left, right, below];
  }

  async function zonesPdf(bytes, zmap, pdfjsLib, PDFLib) {
    var doc = await pdfjsLib.getDocument({data: bytes.slice(0), disableFontFace: true, verbosity: 0}).promise;
    var obstacles = {};
    for (var pno = 1; pno <= doc.numPages; pno++) {
      var page = await doc.getPage(pno);
      var view = page.getViewport({scale: 1});
      var text = await page.getTextContent();
      var lines = readText(text, view.height);
      var words = wordsOf(lines).filter(function (w) { return !w.is_box; });
      obstacles[pno] = words.map(function (w) { return rect(w.x0, w.y0, w.x1, w.y1); });
      zmap.zones.forEach(function (z) {
        if (z.page === pno && z.kind === "check") {
          var r = z.rect;
          obstacles[pno].push(rect(r[0], r[1], r[2], r[3]));
        }
      });
    }
    await doc.destroy();
    var out = await PDFLib.PDFDocument.load(bytes);
    var font = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var pages = out.getPages();
    function drawDown(page, r, H, opts) {
      page.drawRectangle(Object.assign({
        x: r.x0, y: H - r.y1, width: Math.max(rw(r), 0.2), height: Math.max(rh(r), 0.2)
      }, opts));
    }
    zmap.zones.forEach(function (z) {
      if (!z.page) return;
      var page = pages[z.page - 1];
      var H = page.getHeight();
      var color = PDFLib.rgb.apply(null, COLORS[z.kind] || COLORS.text);
      var rects = [z.rect].concat(z.extra || []);
      rects.forEach(function (raw) {
        drawDown(page, rect(raw[0], raw[1], raw[2], raw[3]), H, {borderColor: color, borderWidth: 0.7});
      });
      (z.cells || []).forEach(function (raw) {
        drawDown(page, rect(raw[0], raw[1], raw[2], raw[3]), H, {
          borderColor: color, borderWidth: 0.4, borderDashArray: [1, 1], borderDashPhase: 0
        });
      });
    });
    zmap.zones.forEach(function (z) {
      if (!z.page) return;
      var page = pages[z.page - 1];
      var H = page.getHeight();
      var r = rect(z.rect[0], z.rect[1], z.rect[2], z.rect[3]);
      var fs = rh(r) < 12 || z.kind === "check" ? 5.5 : 6.5;
      var w = font.widthOfTextAtSize(z.id, fs);
      var spots = tagSpots({rect: r, kind: z.kind}, w, fs);
      var chosen = null;
      for (var s = 0; s < spots.length; s++) {
        var x = spots[s][0], y = spots[s][1];
        var bg = rect(x - 0.6, y - fs * 0.8, x + w + 0.6, y + fs * 0.22);
        if (bg.x0 < 0 || bg.x1 > page.getWidth() || bg.y0 < 0) continue;
        var hit = (obstacles[z.page] || []).some(function (o) {
          var inter = intersection(bg, o);
          return !empty(inter);
        });
        if (!hit) { chosen = {x: x, y: y, bg: bg}; break; }
      }
      if (!chosen) {
        var x0 = spots[0][0], y0 = spots[0][1];
        chosen = {x: x0, y: y0, bg: rect(x0 - 0.6, y0 - fs * 0.8, x0 + w + 0.6, y0 + fs * 0.22)};
      }
      obstacles[z.page].push(chosen.bg);
      drawDown(page, chosen.bg, H, {color: PDFLib.rgb(1, 1, 1), opacity: 0.9, borderWidth: 0});
      page.drawText(z.id, {
        x: chosen.x, y: H - chosen.y, size: fs, font: font,
        color: PDFLib.rgb(TAG_COLOR[0], TAG_COLOR[1], TAG_COLOR[2])
      });
    });
    return out.save();
  }

  async function prepare(bytes, filename, pdfjsLib, PDFLib) {
    var zmap = await detectPdf(bytes, pdfjsLib);
    for (var i = 0; i < zmap.zones.length; i++) zmap.zones[i].id = "Z" + (i + 1);
    zmap.map_id = await mapId(bytes);
    zmap.source = filename || "form.pdf";
    zmap.detector = DETECTOR_VERSION;
    var txt = zonesTxt(zmap);
    var pdf = PDFLib ? await zonesPdf(bytes, zmap, pdfjsLib, PDFLib) : null;
    return {zmap: zmap, txt: txt, pdf: pdf};
  }

  return {
    DETECTOR_VERSION: DETECTOR_VERSION,
    prepare: prepare,
    detectPdf: detectPdf,
    zonesTxt: zonesTxt,
    zonesPdf: zonesPdf
  };
})();

if (typeof module === "object" && module.exports) module.exports = Prepare;
