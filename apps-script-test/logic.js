/* Détection de test : mot "helicopter" + cases fermées d'une grille.
   Le repère est celui du PDF (origine en bas à gauche), le même que pdf-lib. */
const PdfTest = (function () {
  "use strict";

  var WORD = "helicopter";
  var LABEL = "voici un helicopter";

  function findHelicopter(items) {
    var usable = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.str && it.width > 0) usable.push(it);
    }
    var lines = [];
    for (var u = 0; u < usable.length; u++) {
      var item = usable[u];
      var y = item.transform[5];
      var line = null;
      for (var l = 0; l < lines.length; l++) {
        if (Math.abs(lines[l].y - y) <= 2) {
          line = lines[l];
          break;
        }
      }
      if (!line) {
        line = {y: y, items: []};
        lines.push(line);
      }
      line.items.push(item);
    }

    var matches = [];
    for (var li = 0; li < lines.length; li++) {
      var group = lines[li];
      group.items.sort(function (a, b) { return a.transform[4] - b.transform[4]; });
      var chars = [];
      var prevRight = null;
      for (var k = 0; k < group.items.length; k++) {
        var it2 = group.items[k];
        var x = it2.transform[4];
        var h = it2.height || Math.abs(it2.transform[3]) || 10;
        if (prevRight !== null && x - prevRight > Math.max(1.2, h * 0.12)) {
          chars.push({ch: " ", x: prevRight, w: x - prevRight, y: it2.transform[5], h: h, skip: true});
        }
        var n = it2.str.length;
        var cw = it2.width / n;
        for (var c = 0; c < n; c++) {
          chars.push({ch: it2.str.charAt(c), x: x + c * cw, w: cw, y: it2.transform[5], h: h, skip: false});
        }
        prevRight = x + it2.width;
      }
      var text = "";
      for (var t = 0; t < chars.length; t++) text += chars[t].ch;
      text = text.toLowerCase();
      var from = 0;
      while (from < text.length) {
        var idx = text.indexOf(WORD, from);
        if (idx < 0) break;
        var slice = [];
        for (var s = idx; s < idx + WORD.length && s < chars.length; s++) {
          if (!chars[s].skip) slice.push(chars[s]);
        }
        if (slice.length) {
          var x0 = slice[0].x;
          var x1 = slice[0].x + slice[0].w;
          var baseline = slice[0].y;
          var height = slice[0].h;
          for (var m = 1; m < slice.length; m++) {
            if (slice[m].x < x0) x0 = slice[m].x;
            var right = slice[m].x + slice[m].w;
            if (right > x1) x1 = right;
            if (slice[m].h > height) height = slice[m].h;
          }
          matches.push({
            x: x0,
            y: baseline - height * 0.22,
            width: Math.max(x1 - x0, 4),
            height: height,
            baseline: baseline
          });
        }
        from = idx + WORD.length;
      }
    }
    return matches;
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

  function paintKind(op, OPS) {
    if (op === OPS.stroke || op === OPS.closeStroke) return "stroke";
    if (op === OPS.fill || op === OPS.eoFill) return "fill";
    if (op === OPS.fillStroke || op === OPS.eoFillStroke ||
        op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) return "both";
    return "";
  }

  function consumePath(pathOps, coords, ctm, kind, OPS) {
    var hs = [];
    var vs = [];
    var ci = 0;
    var cx = 0;
    var cy = 0;
    var sx = 0;
    var sy = 0;
    var stroke = kind === "stroke" || kind === "both";
    var draw = kind === "fill" || kind === "stroke" || kind === "both";
    if (!draw) return {hs: hs, vs: vs};

    function pushLine(x0, y0, x1, y1) {
      var p0 = applyPoint(ctm, x0, y0);
      var p1 = applyPoint(ctm, x1, y1);
      var dx = Math.abs(p1[0] - p0[0]);
      var dy = Math.abs(p1[1] - p0[1]);
      if (dy < 1 && dx > 1.8) hs.push([Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), (p0[1] + p1[1]) / 2]);
      else if (dx < 1 && dy > 1.8) vs.push([(p0[0] + p1[0]) / 2, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])]);
    }

    function pushRect(x, y, w, h) {
      var corners = [
        applyPoint(ctm, x, y),
        applyPoint(ctm, x + w, y),
        applyPoint(ctm, x, y + h),
        applyPoint(ctm, x + w, y + h)
      ];
      var x0 = corners[0][0];
      var x1 = x0;
      var y0 = corners[0][1];
      var y1 = y0;
      for (var i = 1; i < 4; i++) {
        if (corners[i][0] < x0) x0 = corners[i][0];
        if (corners[i][0] > x1) x1 = corners[i][0];
        if (corners[i][1] < y0) y0 = corners[i][1];
        if (corners[i][1] > y1) y1 = corners[i][1];
      }
      var rw = x1 - x0;
      var rh = y1 - y0;
      if (rh <= 2 && rw > 2) hs.push([x0, x1, (y0 + y1) / 2]);
      else if (rw <= 2 && rh > 2) vs.push([(x0 + x1) / 2, y0, y1]);
      else if (stroke && rw > 2 && rh > 2) {
        hs.push([x0, x1, y0]);
        hs.push([x0, x1, y1]);
        vs.push([x0, y0, y1]);
        vs.push([x1, y0, y1]);
      }
    }

    for (var p = 0; p < pathOps.length; p++) {
      var code = pathOps[p];
      if (code === OPS.rectangle) {
        pushRect(coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]);
        ci += 4;
      } else if (code === OPS.moveTo) {
        cx = coords[ci];
        cy = coords[ci + 1];
        sx = cx;
        sy = cy;
        ci += 2;
      } else if (code === OPS.lineTo) {
        var nx = coords[ci];
        var ny = coords[ci + 1];
        pushLine(cx, cy, nx, ny);
        cx = nx;
        cy = ny;
        ci += 2;
      } else if (code === OPS.curveTo) {
        cx = coords[ci + 4];
        cy = coords[ci + 5];
        ci += 6;
      } else if (code === OPS.curveTo2 || code === OPS.curveTo3) {
        cx = coords[ci + 2];
        cy = coords[ci + 3];
        ci += 4;
      } else if (code === OPS.closePath) {
        pushLine(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
      }
    }
    return {hs: hs, vs: vs};
  }

  function mergeCollinear(segs, horizontal) {
    var gap = 4;
    var tol = 0.8;
    var norm = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      norm.push(horizontal ? [s[2], s[0], s[1]] : [s[0], s[1], s[2]]);
    }
    norm.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [];
    for (var n = 0; n < norm.length; n++) {
      var c = norm[n][0];
      var a0 = norm[n][1];
      var a1 = norm[n][2];
      var last = out.length ? out[out.length - 1] : null;
      if (last && Math.abs(last[0] - c) <= tol && a0 <= last[2] + gap && a1 >= last[1] - gap) {
        if (a0 < last[1]) last[1] = a0;
        if (a1 > last[2]) last[2] = a1;
      } else {
        out.push([c, a0, a1]);
      }
    }
    var merged = [];
    for (var j = 0; j < out.length; j++) {
      merged.push(horizontal ? [out[j][1], out[j][2], out[j][0]] : out[j]);
    }
    return merged;
  }

  function clusterLines(segs, crossIdx, a0Idx, a1Idx) {
    var tol = 1.2;
    var overlapPad = 2;
    var n = segs.length;
    if (!n) return {coords: [], spansAt: {}};
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(k) {
      while (parent[k] !== k) {
        parent[k] = parent[parent[k]];
        k = parent[k];
      }
      return k;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    var normed = [];
    for (var s = 0; s < n; s++) {
      var seg = segs[s];
      var c = seg[crossIdx];
      var a0 = seg[a0Idx];
      var a1 = seg[a1Idx];
      if (a0 > a1) {
        var tmp = a0;
        a0 = a1;
        a1 = tmp;
      }
      normed.push([c, a0, a1]);
    }
    var order = [];
    for (var o = 0; o < n; o++) order.push(o);
    order.sort(function (i, j) { return normed[i][0] - normed[j][0]; });
    for (var ii = 0; ii < n; ii++) {
      var ia = order[ii];
      var ci = normed[ia][0];
      var a0i = normed[ia][1];
      var a1i = normed[ia][2];
      for (var jj = ii + 1; jj < n; jj++) {
        var ib = order[jj];
        var cj = normed[ib][0];
        if (cj - ci > tol) break;
        var a0j = normed[ib][1];
        var a1j = normed[ib][2];
        if (a0i <= a1j + overlapPad && a0j <= a1i + overlapPad) union(ia, ib);
      }
    }
    var groups = {};
    for (var g = 0; g < n; g++) {
      var root = find(g);
      if (!groups[root]) groups[root] = [];
      groups[root].push(g);
    }
    var lines = [];
    for (var key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      var idxs = groups[key];
      var num = 0;
      var den = 0;
      var spans = [];
      for (var q = 0; q < idxs.length; q++) {
        var part = normed[idxs[q]];
        var length = Math.max(part[2] - part[1], 0.01);
        num += part[0] * length;
        den += length;
        spans.push([part[1], part[2]]);
      }
      lines.push([num / den, spans]);
    }
    lines.sort(function (a, b) { return a[0] - b[0]; });
    var coords = [];
    var spansAt = {};
    for (var z = 0; z < lines.length; z++) {
      coords.push(lines[z][0]);
      spansAt[z] = lines[z][1];
    }
    return {coords: coords, spansAt: spansAt};
  }

  function gridCells(hs, vs, pageWidth, pageHeight) {
    var v = clusterLines(vs, 0, 1, 2);
    var h = clusterLines(hs, 2, 0, 1);
    var xs = v.coords;
    var ys = h.coords;
    if (xs.length < 2 || ys.length < 2) return [];

    function covered(spans, a, b) {
      for (var i = 0; i < spans.length; i++) {
        if (spans[i][0] <= a + 2 && spans[i][1] >= b - 2) return true;
      }
      return false;
    }

    var nx = xs.length - 1;
    var ny = ys.length - 1;
    var parent = [];
    var total = nx * ny;
    for (var p = 0; p < total; p++) parent.push(p);
    function find(k) {
      while (parent[k] !== k) {
        parent[k] = parent[parent[k]];
        k = parent[k];
      }
      return k;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var k = j * nx + i;
        if (i + 1 < nx && !covered(v.spansAt[i + 1], ys[j], ys[j + 1])) union(k, k + 1);
        if (j + 1 < ny && !covered(h.spansAt[j + 1], xs[i], xs[i + 1])) union(k, k + nx);
      }
    }
    var groups = {};
    for (var c = 0; c < total; c++) {
      var root = find(c);
      if (!groups[root]) groups[root] = [];
      groups[root].push(c);
    }
    var pageArea = pageWidth * pageHeight;
    var cells = [];
    for (var gk in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, gk)) continue;
      var ks = groups[gk];
      var i0 = nx;
      var i1 = -1;
      var j0 = ny;
      var j1 = -1;
      for (var e = 0; e < ks.length; e++) {
        var col = ks[e] % nx;
        var row = Math.floor(ks[e] / nx);
        if (col < i0) i0 = col;
        if (col > i1) i1 = col;
        if (row < j0) j0 = row;
        if (row > j1) j1 = row;
      }
      if (ks.length !== (i1 - i0 + 1) * (j1 - j0 + 1)) continue;
      var closed = true;
      for (var rj = j0; rj <= j1; rj++) {
        if (!covered(v.spansAt[i0], ys[rj], ys[rj + 1]) || !covered(v.spansAt[i1 + 1], ys[rj], ys[rj + 1])) {
          closed = false;
          break;
        }
      }
      for (var ci2 = i0; closed && ci2 <= i1; ci2++) {
        if (!covered(h.spansAt[j0], xs[ci2], xs[ci2 + 1]) || !covered(h.spansAt[j1 + 1], xs[ci2], xs[ci2 + 1])) {
          closed = false;
        }
      }
      if (!closed) continue;
      var x0 = xs[i0];
      var x1 = xs[i1 + 1];
      var y0 = ys[j0];
      var y1 = ys[j1 + 1];
      var w = x1 - x0;
      var ht = y1 - y0;
      if (w < 6 || ht < 6 || w * ht > 0.35 * pageArea) continue;
      cells.push({x0: x0, y0: y0, x1: x1, y1: y1});
    }
    return cells;
  }

  function touches(a, b) {
    var xOv = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    var yOv = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    var xTouch = Math.abs(a.x1 - b.x0) <= 2.5 || Math.abs(b.x1 - a.x0) <= 2.5;
    var yTouch = Math.abs(a.y1 - b.y0) <= 2.5 || Math.abs(b.y1 - a.y0) <= 2.5;
    var ah = a.y1 - a.y0;
    var bh = b.y1 - b.y0;
    var aw = a.x1 - a.x0;
    var bw = b.x1 - b.x0;
    if (xTouch && yOv > 0.5 * Math.min(ah, bh)) return true;
    if (yTouch && xOv > 0.5 * Math.min(aw, bw)) return true;
    return false;
  }

  function tableOnly(cells) {
    var kept = [];
    for (var i = 0; i < cells.length; i++) {
      var neighbor = false;
      for (var j = 0; j < cells.length; j++) {
        if (i !== j && touches(cells[i], cells[j])) {
          neighbor = true;
          break;
        }
      }
      if (neighbor) kept.push(cells[i]);
    }
    return kept;
  }

  function tableRectangles(fnArray, argsArray, OPS, pageWidth, pageHeight) {
    var hs = [];
    var vs = [];
    var ctm = [1, 0, 0, 1, 0, 0];
    var stack = [];
    for (var i = 0; i < fnArray.length; i++) {
      var fn = fnArray[i];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        ctm = stack.length ? stack.pop() : [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        ctm = multiply(ctm, argsArray[i]);
      } else if (fn === OPS.constructPath) {
        var kind = paintKind(fnArray[i + 1], OPS);
        if (!kind) continue;
        var path = argsArray[i];
        var taken = consumePath(path[0], path[1], ctm, kind, OPS);
        for (var a = 0; a < taken.hs.length; a++) hs.push(taken.hs[a]);
        for (var b = 0; b < taken.vs.length; b++) vs.push(taken.vs[b]);
      }
    }
    hs = mergeCollinear(hs, true);
    vs = mergeCollinear(vs, false);
    return tableOnly(gridCells(hs, vs, pageWidth, pageHeight));
  }

  function markPdf(pdfBytes, pages, PDFLib) {
    var PDFDocument = PDFLib.PDFDocument;
    var StandardFonts = PDFLib.StandardFonts;
    var rgb = PDFLib.rgb;
    return PDFDocument.load(pdfBytes).then(function (doc) {
      return doc.embedFont(StandardFonts.Helvetica).then(function (font) {
        var formPages = doc.getPages();
        for (var i = 0; i < pages.length && i < formPages.length; i++) {
          var page = formPages[i];
          var marks = pages[i];
          var cells = marks.cells || [];
          var words = marks.words || [];
          for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            page.drawRectangle({
              x: cell.x0,
              y: cell.y0,
              width: cell.x1 - cell.x0,
              height: cell.y1 - cell.y0,
              color: rgb(0.55, 0.82, 1),
              opacity: 0.28,
              borderColor: rgb(0.1, 0.4, 0.8),
              borderWidth: 0.7,
              borderOpacity: 0.9
            });
          }
          for (var w = 0; w < words.length; w++) {
            var word = words[w];
            page.drawRectangle({
              x: word.x,
              y: word.y,
              width: word.width,
              height: word.height,
              color: rgb(1, 0.9, 0.15),
              opacity: 0.55,
              borderWidth: 0
            });
            var size = 8;
            var ty = word.y - 3 - size;
            if (ty < 4) ty = word.y + word.height + 2;
            page.drawText(LABEL, {
              x: word.x,
              y: ty,
              size: size,
              font: font,
              color: rgb(0.05, 0.12, 0.45)
            });
          }
        }
        return doc.save();
      });
    });
  }

  return {
    WORD: WORD,
    LABEL: LABEL,
    findHelicopter: findHelicopter,
    tableRectangles: tableRectangles,
    markPdf: markPdf
  };
})();

if (typeof module === "object" && module.exports) module.exports = PdfTest;
