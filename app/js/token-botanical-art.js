/*
 * Botanical line-art token cards (seed → harvest).
 * Extends the growtoo logo glyph: calm documentation aesthetic,
 * soil cross-section + roots, two-tone leaves, harvest bud cluster.
 *
 * Shared by in-app SVG sprites and chain PNG generator.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TokenBotanicalArt = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STAGE_KEYS = ['seed', 'germination', 'seedling', 'vegetative', 'flowering', 'harvest'];
  var STAGE_LABELS = ['Seed', 'Germination', 'Seedling', 'Vegetative', 'Flowering', 'Harvest'];

  var C = {
    bg: '#132016',
    bracket: '#8fa88a',
    label: '#f3efe6',
    soil: '#5a3a24',
    soilEdge: '#3d2718',
    root: '#a67c52',
    stem: '#3f7a48',
    leafDark: '#2f6b3a',
    leafLight: '#6fad58',
    leafVein: '#1e4a28',
    tip: '#d4843a',
    bud: '#d4a84a',
    budDeep: '#b8862e',
    budHi: '#f5e6b8',
    sealRing: '#c9a55e',
    sealDot: '#d8b872',
  };

  var VW = 200;
  var VH = 280;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function leafPairSvg(cx, cy, spread, size, fill) {
    var w = size;
    var h = size * 0.72;
    var left =
      '<g transform="translate(' +
      (cx - spread) +
      ' ' +
      cy +
      ') rotate(-28)">' +
      '<ellipse cx="0" cy="0" rx="' +
      w +
      '" ry="' +
      h +
      '" fill="' +
      fill +
      '" stroke="' +
      C.leafVein +
      '" stroke-width="0.9"/>' +
      '<line x1="' +
      -w * 0.55 +
      '" y1="0" x2="' +
      w * 0.55 +
      '" y2="0" stroke="' +
      C.leafVein +
      '" stroke-width="1.1" stroke-linecap="round"/>' +
      '</g>';
    var right =
      '<g transform="translate(' +
      (cx + spread) +
      ' ' +
      cy +
      ') rotate(28)">' +
      '<ellipse cx="0" cy="0" rx="' +
      w +
      '" ry="' +
      h +
      '" fill="' +
      fill +
      '" stroke="' +
      C.leafVein +
      '" stroke-width="0.9"/>' +
      '<line x1="' +
      -w * 0.55 +
      '" y1="0" x2="' +
      w * 0.55 +
      '" y2="0" stroke="' +
      C.leafVein +
      '" stroke-width="1.1" stroke-linecap="round"/>' +
      '</g>';
    return left + right;
  }

  function rootsSvg(cx, soilY) {
    return (
      '<g fill="none" stroke="' +
      C.root +
      '" stroke-width="1.35" stroke-linecap="round">' +
      '<path d="M' +
      cx +
      ' ' +
      soilY +
      ' C' +
      (cx - 6) +
      ' ' +
      (soilY + 14) +
      ' ' +
      (cx - 18) +
      ' ' +
      (soilY + 28) +
      ' ' +
      (cx - 22) +
      ' ' +
      (soilY + 40) +
      '"/>' +
      '<path d="M' +
      cx +
      ' ' +
      soilY +
      ' C' +
      (cx + 4) +
      ' ' +
      (soilY + 16) +
      ' ' +
      (cx + 14) +
      ' ' +
      (soilY + 30) +
      ' ' +
      (cx + 20) +
      ' ' +
      (soilY + 42) +
      '"/>' +
      '<path d="M' +
      cx +
      ' ' +
      soilY +
      ' C' +
      (cx - 2) +
      ' ' +
      (soilY + 18) +
      ' ' +
      (cx - 4) +
      ' ' +
      (soilY + 32) +
      ' ' +
      (cx - 2) +
      ' ' +
      (soilY + 44) +
      '"/>' +
      '<path d="M' +
      (cx - 8) +
      ' ' +
      (soilY + 12) +
      ' C' +
      (cx - 16) +
      ' ' +
      (soilY + 20) +
      ' ' +
      (cx - 28) +
      ' ' +
      (soilY + 26) +
      ' ' +
      (cx - 34) +
      ' ' +
      (soilY + 34) +
      '"/>' +
      '<path d="M' +
      (cx + 6) +
      ' ' +
      (soilY + 10) +
      ' C' +
      (cx + 14) +
      ' ' +
      (soilY + 18) +
      ' ' +
      (cx + 24) +
      ' ' +
      (soilY + 24) +
      ' ' +
      (cx + 30) +
      ' ' +
      (soilY + 32) +
      '"/>' +
      '</g>'
    );
  }

  function budClusterSvg(cx, cy, full) {
    var buds = full
      ? [
          [0, 0, 11],
          [-9, 4, 7.5],
          [9, 5, 7],
          [-5, -8, 6],
          [6, -7, 5.5],
          [0, 10, 5],
          [-12, -2, 4.5],
          [13, -1, 4],
        ]
      : [
          [0, 0, 5.5],
          [-5, 3, 3.5],
          [5, 2.5, 3.2],
          [0, -4, 3],
        ];
    return buds
      .map(function (b) {
        var x = cx + b[0];
        var y = cy + b[1];
        var r = b[2];
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="' +
          r +
          '" fill="' +
          C.bud +
          '"/>' +
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="' +
          r +
          '" fill="none" stroke="' +
          C.budDeep +
          '" stroke-width="0.8"/>' +
          '<circle cx="' +
          (x - r * 0.28) +
          '" cy="' +
          (y - r * 0.32) +
          '" r="' +
          Math.max(1.1, r * 0.18) +
          '" fill="' +
          C.budHi +
          '" opacity="0.85"/>'
        );
      })
      .join('');
  }

  function plantBodySvg(stage) {
    var cx = 100;
    var soilY = 188;
    var parts = [];
    parts.push(rootsSvg(cx, soilY));

    if (stage === 0) {
      parts.push(
        '<ellipse cx="' +
          cx +
          '" cy="' +
          (soilY - 4) +
          '" rx="9" ry="6" fill="' +
          C.tip +
          '"/>' +
          '<ellipse cx="' +
          (cx - 2) +
          '" cy="' +
          (soilY - 6) +
          '" rx="2.2" ry="1.6" fill="' +
          C.budHi +
          '" opacity="0.7"/>'
      );
      return parts.join('');
    }

    var topY = stage === 1 ? 148 : stage === 2 ? 118 : stage === 3 ? 96 : stage === 4 ? 88 : 78;
    parts.push(
      '<line class="grow-stem" x1="' +
        cx +
        '" y1="' +
        soilY +
        '" x2="' +
        cx +
        '" y2="' +
        topY +
        '" stroke="' +
        C.stem +
        '" stroke-width="2.4" stroke-linecap="round"/>'
    );

    if (stage === 1) {
      parts.push(leafPairSvg(cx, 158, 14, 11, C.leafLight));
      parts.push(
        '<circle cx="' + cx + '" cy="' + (topY - 2) + '" r="3.2" fill="' + C.tip + '"/>'
      );
      return parts.join('');
    }

    // Mature leaf pairs (bottom darker, top lighter)
    if (stage >= 2) {
      parts.push(leafPairSvg(cx, 168, 18, 13, C.leafDark));
      parts.push(leafPairSvg(cx, 142, 16, 11, C.leafLight));
    }
    if (stage >= 3) {
      parts.push(leafPairSvg(cx, 118, 15, 12, C.leafDark));
      parts.push(leafPairSvg(cx, 98, 13, 10, C.leafLight));
    }
    if (stage === 2) {
      parts.push(
        '<circle cx="' + cx + '" cy="' + (topY - 2) + '" r="3.4" fill="' + C.tip + '"/>'
      );
    } else if (stage === 3) {
      parts.push(
        '<circle cx="' + cx + '" cy="' + (topY - 2) + '" r="3.6" fill="' + C.tip + '"/>'
      );
    } else if (stage === 4) {
      parts.push(budClusterSvg(cx, topY + 2, false));
    } else if (stage >= 5) {
      parts.push(budClusterSvg(cx, topY + 6, true));
    }

    return parts.join('');
  }

  function cardChromeSvg(stage, showLabel) {
    var label = STAGE_LABELS[stage] || 'Plant';
    var title = stage + 1 + ' · ' + label;
    var brackets =
      '<g fill="none" stroke="' +
      C.bracket +
      '" stroke-width="1.4" stroke-linecap="round">' +
      '<path d="M18 32 V18 H32"/>' +
      '<path d="M182 32 V18 H168"/>' +
      '<path d="M18 248 V262 H32"/>' +
      '<path d="M182 248 V262 H168"/>' +
      '</g>';
    var seal =
      '<g class="grow-seal">' +
      '<circle cx="100" cy="255" r="7.5" fill="' +
      C.bg +
      '" stroke="' +
      C.sealRing +
      '" stroke-width="1.5"/>' +
      '<circle cx="100" cy="255" r="2.6" fill="' +
      C.sealDot +
      '"/>' +
      '</g>';
    var labelSvg = showLabel
      ? '<text x="100" y="36" text-anchor="middle" fill="' +
        C.label +
        '" font-family="Archivo, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.04em">' +
        esc(title) +
        '</text>'
      : '';
    return brackets + labelSvg + seal;
  }

  function renderStageSvg(stageIndex, options) {
    var opts = options || {};
    var stage = Math.max(0, Math.min(5, Number(stageIndex) || 0));
    var hero = !!opts.hero;
    var compact = !!opts.compact;
    var animate = !!opts.animate;
    var noBg = !!opts.noBg;
    var showLabel = opts.showLabel !== false && !noBg;
    var label = STAGE_LABELS[stage] || 'Plant';

    var cls =
      'plant-grow-svg plant-grow-svg--botanical plant-grow-svg--s' +
      stage +
      (hero ? ' plant-grow-svg--hero' : '') +
      (compact ? ' plant-grow-svg--compact' : '') +
      (animate ? ' plant-grow-svg--animate' : '');

    var soil =
      '<rect x="48" y="188" width="104" height="48" rx="2" fill="' +
      C.soil +
      '"/>' +
      '<rect x="48" y="188" width="104" height="3" fill="' +
      C.soilEdge +
      '" opacity="0.55"/>';

    var body;
    if (noBg) {
      body =
        '<g transform="translate(0 -8)">' +
        soil +
        plantBodySvg(stage) +
        '</g>';
      return (
        '<svg class="' +
        cls +
        '" viewBox="40 70 120 180" role="img" aria-label="' +
        esc(label) +
        ' stage" xmlns="http://www.w3.org/2000/svg">' +
        body +
        '</svg>'
      );
    }

    body =
      '<rect class="grow-nft-bg" width="' +
      VW +
      '" height="' +
      VH +
      '" rx="18" fill="' +
      C.bg +
      '"/>' +
      cardChromeSvg(stage, showLabel) +
      soil +
      '<g class="grow-plant">' +
      plantBodySvg(stage) +
      '</g>';

    return (
      '<svg class="' +
      cls +
      '" viewBox="0 0 ' +
      VW +
      ' ' +
      VH +
      '" role="img" aria-label="' +
      esc(label) +
      ' stage" xmlns="http://www.w3.org/2000/svg">' +
      body +
      '</svg>'
    );
  }

  // --- PNG raster path (no canvas dependency) -----------------------------

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function createBuf(w, h, fillHex) {
    var rgba = Buffer ? Buffer.alloc(w * h * 4) : new Uint8Array(w * h * 4);
    var c = hexToRgb(fillHex);
    for (var i = 0; i < w * h; i += 1) {
      var o = i * 4;
      rgba[o] = c.r;
      rgba[o + 1] = c.g;
      rgba[o + 2] = c.b;
      rgba[o + 3] = 255;
    }
    return { width: w, height: h, rgba: rgba };
  }

  function setPx(buf, x, y, hex, a) {
    var xi = Math.round(x);
    var yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= buf.width || yi >= buf.height) return;
    var c = hexToRgb(hex);
    var o = (yi * buf.width + xi) * 4;
    var alpha = a == null ? 1 : a;
    if (alpha >= 1) {
      buf.rgba[o] = c.r;
      buf.rgba[o + 1] = c.g;
      buf.rgba[o + 2] = c.b;
      buf.rgba[o + 3] = 255;
      return;
    }
    var inv = 1 - alpha;
    buf.rgba[o] = Math.round(c.r * alpha + buf.rgba[o] * inv);
    buf.rgba[o + 1] = Math.round(c.g * alpha + buf.rgba[o + 1] * inv);
    buf.rgba[o + 2] = Math.round(c.b * alpha + buf.rgba[o + 2] * inv);
    buf.rgba[o + 3] = 255;
  }

  function fillRect(buf, x, y, w, h, hex) {
    for (var yy = y; yy < y + h; yy += 1) {
      for (var xx = x; xx < x + w; xx += 1) setPx(buf, xx, yy, hex);
    }
  }

  function fillCircle(buf, cx, cy, r, hex) {
    var r2 = r * r;
    for (var yy = -r; yy <= r; yy += 1) {
      for (var xx = -r; xx <= r; xx += 1) {
        if (xx * xx + yy * yy <= r2) setPx(buf, cx + xx, cy + yy, hex);
      }
    }
  }

  function strokeCircle(buf, cx, cy, r, hex, t) {
    var thick = t || 1;
    for (var a = 0; a < Math.PI * 2; a += 0.01) {
      for (var k = 0; k < thick; k += 1) {
        setPx(buf, cx + Math.cos(a) * (r - k), cy + Math.sin(a) * (r - k), hex);
      }
    }
  }

  function drawLine(buf, x0, y0, x1, y1, hex, t) {
    var thick = Math.max(1, t || 1);
    var dx = x1 - x0;
    var dy = y1 - y0;
    var steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)));
    for (var i = 0; i <= steps; i += 1) {
      var x = x0 + (dx * i) / steps;
      var y = y0 + (dy * i) / steps;
      for (var ox = -thick; ox <= thick; ox += 1) {
        for (var oy = -thick; oy <= thick; oy += 1) {
          if (ox * ox + oy * oy <= thick * thick) setPx(buf, x + ox, y + oy, hex);
        }
      }
    }
  }

  function fillEllipse(buf, cx, cy, rx, ry, rotDeg, hex) {
    var rot = (rotDeg * Math.PI) / 180;
    var cos = Math.cos(rot);
    var sin = Math.sin(rot);
    var bound = Math.ceil(Math.max(rx, ry) + 2);
    for (var yy = -bound; yy <= bound; yy += 1) {
      for (var xx = -bound; xx <= bound; xx += 1) {
        var lx = xx * cos + yy * sin;
        var ly = -xx * sin + yy * cos;
        if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) {
          setPx(buf, cx + xx, cy + yy, hex);
        }
      }
    }
  }

  function leafPairRaster(buf, cx, cy, spread, size, fill, s) {
    var w = size * s;
    var h = size * 0.72 * s;
    fillEllipse(buf, cx - spread * s, cy, w, h, -28, fill);
    fillEllipse(buf, cx + spread * s, cy, w, h, 28, fill);
    drawLine(buf, cx - spread * s - w * 0.45, cy, cx - spread * s + w * 0.45, cy, C.leafVein, Math.max(1, s * 0.5));
    drawLine(buf, cx + spread * s - w * 0.45, cy, cx + spread * s + w * 0.45, cy, C.leafVein, Math.max(1, s * 0.5));
  }

  function renderStageRgba(stageIndex, size) {
    var stage = Math.max(0, Math.min(5, Number(stageIndex) || 0));
    var outW = Math.max(128, Number(size) || 512);
    var outH = Math.round((outW * VH) / VW);
    var ss = 2; // supersample for smooth edges
    var hi = renderStageRgbaHi(stage, outW * ss, outH * ss);
    return downsample(hi, outW, outH, ss);
  }

  function downsample(src, outW, outH, ss) {
    var rgba = Buffer ? Buffer.alloc(outW * outH * 4) : new Uint8Array(outW * outH * 4);
    for (var y = 0; y < outH; y += 1) {
      for (var x = 0; x < outW; x += 1) {
        var r = 0;
        var g = 0;
        var b = 0;
        var a = 0;
        var n = 0;
        for (var oy = 0; oy < ss; oy += 1) {
          for (var ox = 0; ox < ss; ox += 1) {
            var sx = x * ss + ox;
            var sy = y * ss + oy;
            var o = (sy * src.width + sx) * 4;
            r += src.rgba[o];
            g += src.rgba[o + 1];
            b += src.rgba[o + 2];
            a += src.rgba[o + 3];
            n += 1;
          }
        }
        var d = (y * outW + x) * 4;
        rgba[d] = Math.round(r / n);
        rgba[d + 1] = Math.round(g / n);
        rgba[d + 2] = Math.round(b / n);
        rgba[d + 3] = Math.round(a / n);
      }
    }
    return { width: outW, height: outH, rgba: rgba };
  }

  function renderStageRgbaHi(stage, width, height) {
    var s = width / VW;
    var buf = createBuf(width, height, C.bg);

    function X(v) {
      return v * s;
    }
    function Y(v) {
      return v * s;
    }

    var bt = Math.max(1, s * 0.7);
    drawLine(buf, X(18), Y(32), X(18), Y(18), C.bracket, bt);
    drawLine(buf, X(18), Y(18), X(32), Y(18), C.bracket, bt);
    drawLine(buf, X(182), Y(32), X(182), Y(18), C.bracket, bt);
    drawLine(buf, X(182), Y(18), X(168), Y(18), C.bracket, bt);
    drawLine(buf, X(18), Y(248), X(18), Y(262), C.bracket, bt);
    drawLine(buf, X(18), Y(262), X(32), Y(262), C.bracket, bt);
    drawLine(buf, X(182), Y(248), X(182), Y(262), C.bracket, bt);
    drawLine(buf, X(182), Y(262), X(168), Y(262), C.bracket, bt);

    fillRect(buf, X(48), Y(188), X(104), Y(48), C.soil);
    fillRect(buf, X(48), Y(188), X(104), Math.max(1, Y(3)), C.soilEdge);

    var cx = X(100);
    var soilY = Y(188);

    drawLine(buf, cx, soilY, X(78), Y(228), C.root, Math.max(1, s * 0.65));
    drawLine(buf, cx, soilY, X(120), Y(230), C.root, Math.max(1, s * 0.65));
    drawLine(buf, cx, soilY, X(98), Y(232), C.root, Math.max(1, s * 0.55));
    drawLine(buf, X(92), Y(200), X(66), Y(222), C.root, Math.max(1, s * 0.5));
    drawLine(buf, X(106), Y(198), X(130), Y(220), C.root, Math.max(1, s * 0.5));

    if (stage === 0) {
      fillEllipse(buf, cx, soilY - Y(4), X(9), Y(6), 0, C.tip);
      fillCircle(buf, cx - X(2), soilY - Y(6), X(2), C.budHi);
    } else {
      var topY =
        stage === 1 ? Y(148) : stage === 2 ? Y(118) : stage === 3 ? Y(96) : stage === 4 ? Y(88) : Y(78);
      drawLine(buf, cx, soilY, cx, topY, C.stem, Math.max(1, s * 1.1));

      if (stage === 1) {
        leafPairRaster(buf, cx, Y(158), 14, 11, C.leafLight, s);
        fillCircle(buf, cx, topY - Y(2), X(3.2), C.tip);
      } else {
        if (stage >= 2) {
          leafPairRaster(buf, cx, Y(168), 18, 13, C.leafDark, s);
          leafPairRaster(buf, cx, Y(142), 16, 11, C.leafLight, s);
        }
        if (stage >= 3) {
          leafPairRaster(buf, cx, Y(118), 15, 12, C.leafDark, s);
          leafPairRaster(buf, cx, Y(98), 13, 10, C.leafLight, s);
        }
        if (stage === 2 || stage === 3) {
          fillCircle(buf, cx, topY - Y(2), X(3.4), C.tip);
        } else if (stage === 4 || stage >= 5) {
          var full = stage >= 5;
          var buds = full
            ? [
                [0, 6, 11],
                [-9, 10, 7.5],
                [9, 11, 7],
                [-5, -2, 6],
                [6, -1, 5.5],
                [0, 16, 5],
                [-12, 4, 4.5],
                [13, 5, 4],
              ]
            : [
                [0, 2, 5.5],
                [-5, 5, 3.5],
                [5, 4.5, 3.2],
                [0, -2, 3],
              ];
          buds.forEach(function (b) {
            var bx = cx + X(b[0]);
            var by = topY + Y(b[1]);
            var br = X(b[2]);
            fillCircle(buf, bx, by, br, C.bud);
            strokeCircle(buf, bx, by, br, C.budDeep, Math.max(1, s * 0.4));
            fillCircle(buf, bx - br * 0.28, by - br * 0.32, Math.max(1, br * 0.18), C.budHi);
          });
        }
      }
    }

    fillCircle(buf, X(100), Y(255), X(7.5), C.bg);
    strokeCircle(buf, X(100), Y(255), X(7.5), C.sealRing, Math.max(1, s * 0.7));
    fillCircle(buf, X(100), Y(255), X(2.6), C.sealDot);

    return buf;
  }

  return {
    STAGE_KEYS: STAGE_KEYS,
    STAGE_LABELS: STAGE_LABELS,
    VW: VW,
    VH: VH,
    COLORS: C,
    renderStageSvg: renderStageSvg,
    renderStageRgba: renderStageRgba,
  };
});
