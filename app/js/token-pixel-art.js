/*
 * Pixel token art — chunky 32×32 potted plant (seed → harvest).
 * Matches the retro NFT style: charcoal bg, gold card edge, brown pot,
 * bushy foliage, orange bloom accents, cyan sparkles.
 *
 * Shared by in-app SVG sprites and chain PNG generator.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TokenPixelArt = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZE = 32;

  /** Palette keys used in templates. */
  const PALETTE = {
    '.': null, // transparent / empty (bg filled separately)
    B: '#2c2c2c', // charcoal background (NFT canvases)
    K: '#1a1a1a', // deeper shadow
    P: '#b8733a', // pot body
    p: '#8a4e28', // pot shadow / rim
    q: '#6b3a1c', // pot deep
    S: '#243d28', // stem
    D: '#1e5a2c', // leaf dark
    M: '#2f8f3d', // leaf mid
    L: '#5cbc4a', // leaf light
    H: '#8fd95a', // leaf highlight
    O: '#e67e22', // bloom orange
    Y: '#f1c40f', // bloom yellow
    C: '#6ec6e8', // sparkle cyan
    // Gold NFT card edge
    G: '#7a5a12', // outer bronze
    g: '#c9a227', // mid gold
    F: '#f0d060', // bright gold
    f: '#fff3a8', // highlight gold
  };

  const STAGE_KEYS = ['seed', 'germination', 'seedling', 'vegetative', 'flowering', 'harvest'];

  function emptyGrid(fill) {
    const ch = fill == null ? '.' : fill;
    const rows = [];
    for (let y = 0; y < SIZE; y += 1) rows.push(new Array(SIZE).fill(ch));
    return rows;
  }

  function plot(grid, x, y, ch) {
    if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) return;
    if (ch && ch !== '.') grid[y][x] = ch;
  }

  function stamp(grid, template, ox, oy) {
    for (let y = 0; y < template.length; y += 1) {
      const row = template[y];
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        if (ch !== '.' && ch !== ' ') plot(grid, ox + x, oy + y, ch);
      }
    }
  }

  /** Simple tapered pot — reference style. */
  const POT = [
    '..pppppppppp..',
    '.PPPPPPPPPPPP.',
    '.PPPPPPPPPPPP.',
    '.pPPPPPPPPPPp.',
    '..pPPPPPPPPp..',
    '..pqqqqqqqqp..',
    '...qqqqqqqq...',
  ];

  const SEED = ['..Y.', '.OeO', '..Y.'];

  const SPROUT = ['.H.', 'LML', '.S.'];

  /** Small bushy seedling. */
  const BUSH_SM = [
    '...HLH...',
    '..LMMML..',
    '.LMDMDML.',
    '..LMMML..',
    '...LSL...',
  ];

  /** Mid vegetative bush — asymmetrical like the reference. */
  const BUSH_MD = [
    '....HLH....',
    '...HMMMH...',
    '..LMMDMML..',
    '.LHMDMDMHL.',
    '..LMMDMML..',
    '...LMSML...',
    '....LSL....',
  ];

  /**
   * Flowering bush — chunky asymmetrical foliage like the reference token:
   * light top-left, dark right shadow, orange bloom, cyan sparkles.
   */
  const BUSH_FL = [
    '.......C.......',
    '......C........',
    '..OY.HLH.......',
    '.YOHHMMMH......',
    '..LHMMDMDML....',
    '.LMMMDMDDML....',
    'LHMMMDMDDMML...',
    '.LMMDMDDDML.C..',
    '..LHMDMDMML....',
    '...LLMSMLL.....',
    '....LLSLL......',
    '.....LSL.......',
  ];

  /** Harvest — denser blooms + more sparkles. */
  const BUSH_HV = [
    '....C...C......',
    '...C.OYHLH.C...',
    '..YOYHMMMHY....',
    '.LHMMMDMDML....',
    'LHMMMDMDDMML...',
    '.OYMMDMDDMHYO.C',
    '..LMMDMDDML....',
    '.LHMMDMDMMHL...',
    '..LLHMSMHLL....',
    '....LLSLL......',
    '.....LSL.......',
  ];

  function drawPot(grid) {
    // Shifted up so content clears the 2px gold frame.
    stamp(grid, POT, 9, 23);
  }

  function drawStem(grid, y0, y1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
      plot(grid, 15, y, 'S');
      plot(grid, 16, y, 'S');
    }
  }

  /**
   * Gold NFT card edge — 2px bevel with corner highlights.
   * Outer bronze → mid gold → bright inner lip + corner sparkles.
   */
  function drawGoldFrame(grid) {
    const last = SIZE - 1;
    const inner = SIZE - 2;

    for (let i = 0; i < SIZE; i += 1) {
      // Outer rim
      plot(grid, i, 0, 'G');
      plot(grid, i, last, 'G');
      plot(grid, 0, i, 'G');
      plot(grid, last, i, 'G');
      // Inner gold lip
      plot(grid, i, 1, 'g');
      plot(grid, i, inner, 'g');
      plot(grid, 1, i, 'g');
      plot(grid, inner, i, 'g');
    }

    // Bright bevel on top + left (light source)
    for (let i = 1; i < inner; i += 1) {
      plot(grid, i, 1, 'F');
      plot(grid, 1, i, 'F');
    }
    // Slightly darker bottom + right of inner lip
    for (let i = 2; i < last; i += 1) {
      plot(grid, i, inner, 'G');
      plot(grid, inner, i, 'G');
    }
    plot(grid, inner, inner, 'G');

    // Corner highlights
    plot(grid, 1, 1, 'f');
    plot(grid, 2, 1, 'f');
    plot(grid, 1, 2, 'f');
    plot(grid, last - 1, 1, 'F');
    plot(grid, 1, last - 1, 'g');
    plot(grid, last - 1, last - 1, 'G');
  }

  function buildStage(stageIndex, options) {
    const opts = options || {};
    const withBg = !!opts.withBg;
    const withFrame = opts.withFrame != null ? !!opts.withFrame : withBg;
    const grid = emptyGrid(withBg ? 'B' : '.');
    const stage = Math.max(0, Math.min(5, Number(stageIndex) || 0));

    drawPot(grid);

    switch (stage) {
      case 0:
        stamp(grid, SEED, 14, 20);
        break;
      case 1:
        stamp(grid, SEED, 14, 21);
        stamp(grid, SPROUT, 14, 17);
        plot(grid, 20, 14, 'C');
        break;
      case 2:
        drawStem(grid, 22, 18);
        stamp(grid, BUSH_SM, 11, 12);
        plot(grid, 21, 11, 'C');
        break;
      case 3:
        drawStem(grid, 22, 16);
        stamp(grid, BUSH_MD, 10, 8);
        plot(grid, 22, 7, 'C');
        plot(grid, 23, 9, 'C');
        break;
      case 4:
        drawStem(grid, 22, 14);
        stamp(grid, BUSH_FL, 8, 3);
        break;
      case 5:
      default:
        drawStem(grid, 22, 13);
        stamp(grid, BUSH_HV, 8, 2);
        break;
    }

    if (withFrame) drawGoldFrame(grid);

    return grid;
  }

  function gridToPixels(grid) {
    const pixels = [];
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const hex = PALETTE[grid[y][x]];
        if (hex) pixels.push({ x: x, y: y, color: hex });
      }
    }
    return pixels;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  /** Expand grid to RGBA buffer (scale × scale). */
  function gridToRgba(grid, scale) {
    const s = Math.max(1, Number(scale) || 1);
    const w = SIZE * s;
    const h = SIZE * s;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const hex = PALETTE[grid[y][x]];
        if (!hex) continue;
        const { r, g, b } = hexToRgb(hex);
        for (let dy = 0; dy < s; dy += 1) {
          for (let dx = 0; dx < s; dx += 1) {
            const i = ((y * s + dy) * w + (x * s + dx)) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
          }
        }
      }
    }
    return { width: w, height: h, rgba: rgba };
  }

  return {
    SIZE: SIZE,
    PALETTE: PALETTE,
    STAGE_KEYS: STAGE_KEYS,
    buildStage: buildStage,
    gridToPixels: gridToPixels,
    gridToRgba: gridToRgba,
    hexToRgb: hexToRgb,
  };
});
