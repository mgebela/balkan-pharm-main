/*
 * Pixel-art hemp dNFT — 64×64, single centered plant per stage.
 * Alternating fan leaves on one stem; dense cola at flower/harvest.
 */
(function () {
  'use strict';

  const SIZE = 64;
  const CX = 32;
  const POT_TOP = 52;
  const PLANT_ROWS = POT_TOP;

  const C = {
    '.': '',
    K: '#15202b',
    P: '#e09050',
    p: '#c06830',
    q: '#8a4820',
    S: '#6b4a30',
    s: '#4a3220',
    G: '#48a850',
    g: '#2e7038',
    L: '#60c060',
    l: '#3a9048',
    H: '#90e088',
    h: '#c0f0b0',
    B: '#98d858',
    b: '#c8f078',
    Y: '#e8b830',
    y: '#f8e070',
    e: '#c8a040',
    E: '#907020',
    T: '#40d8c8',
    t: '#28a898',
    A: '#f0a830',
    a: '#ffd878',
    F: '#e87828',
    f: '#ffaa40',
  };

  function emptyGrid() {
    const rows = [];
    for (let y = 0; y < SIZE; y += 1) rows.push(new Array(SIZE).fill('.'));
    return rows;
  }

  function plot(grid, x, y, ch) {
    if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) return;
    if (ch && ch !== '.') grid[y][x] = ch;
  }

  function stampTemplate(grid, template, ox, oy) {
    for (let y = 0; y < template.length; y += 1) {
      const row = template[y];
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        if (ch !== '.' && ch !== ' ') plot(grid, ox + x, oy + y, ch);
      }
    }
  }

  function mirrorTemplate(template) {
    return template.map(function (row) {
      return row.split('').reverse().join('');
    });
  }

  /** Cannabis fan leaf — attaches at bottom-center of template. */
  const LEAF_SM = ['...HlH...', '..lLgLl..', '.lLgGgLl.', '..lLgLl..', '...LgL...'];
  const LEAF_MD = ['....HhH....', '...lLgLl...', '..lLgGGgLl..', '.lLHggGHl.', '..lLgGgLl..', '...LgGgL...', '....gG....'];
  const LEAF_LG = [
    '......HhH......',
    '.....lLgLl.....',
    '....lLgGGgLl....',
    '...lLgGHHgGl...',
    '..lLHggGGhHl..',
    '.lLgGHHHHgGl.',
    '..lLgGHHgGl..',
    '...lLgGGgLl...',
    '....LgGgL....',
    '.....gGg.....',
    '......g......',
  ];

  const COLA_GREEN = [
    '.....bBb.....',
    '....bBBBb....',
    '...bBBBBBb...',
    '..bBBBBBBBb..',
    '.bBBBBBBBBBb.',
    '..bBBBBBBBb..',
    '...bBBBBBb...',
    '....bBBBb....',
    '.....bBb.....',
    '.....LgL.....',
  ];
  const COLA_HARVEST = [
    '.....TyT.....',
    '....yAYAy....',
    '...yAYFAYy...',
    '..yAYFFFAYy..',
    '.yAYFFFFAYy.',
    '..yAYFFFAYy..',
    '...yAYFAYy...',
    '....yAYAy....',
    '.....YyY.....',
    '.....LgL.....',
  ];

  const COTYLEDON = ['.lLgLl.', 'lLgGgLl', '.lLgLl.'];

  /** Pad a sprite row to full canvas width, centered horizontally. */
  function padCenter(row) {
    if (row.length >= SIZE) return row.slice(0, SIZE);
    const left = Math.floor((SIZE - row.length) / 2);
    return '.'.repeat(left) + row + '.'.repeat(SIZE - row.length - left);
  }

  const POT_LINES = [
    'SSSSSSSSSSSSSSSSSS',
    'PPPPPPPPPPPPPPPPPPPP',
    'pppppppppppppppppppp',
    'pPPPPPPPPPPPPPPPPPPp',
    'pPP..............PPp',
    'pPP..............PPp',
    'pPP..............PPp',
    'pqqqqqqqqqqqqqqqqqqp',
    'qqqqqqqqqqqqqqqqqqqq',
    'qqqqqqqqqqqqqqqqqqq',
  ].map(padCenter);

  function drawPot(grid) {
    stampTemplate(grid, POT_LINES, 0, POT_TOP);
  }

  function drawStem(grid, y0, y1) {
    const top = Math.min(y0, y1);
    const bot = Math.max(y0, y1);
    for (let y = top; y <= bot; y += 1) {
      plot(grid, CX - 1, y, 'g');
      plot(grid, CX, y, 'G');
      plot(grid, CX + 1, y, 'g');
    }
  }

  function leafLeft(grid, attachY, size) {
    const t = size === 'lg' ? LEAF_LG : size === 'md' ? LEAF_MD : LEAF_SM;
    // Attach leaf base to left side of stem (stem center CX).
    stampTemplate(grid, t, CX - t[0].length, attachY - t.length + 1);
  }

  function leafRight(grid, attachY, size) {
    const t = size === 'lg' ? LEAF_LG : size === 'md' ? LEAF_MD : LEAF_SM;
    // Attach leaf base to right side of stem (stem center CX).
    stampTemplate(grid, mirrorTemplate(t), CX + 1, attachY - t.length + 1);
  }

  function drawCola(grid, topY, harvest) {
    const t = harvest ? COLA_HARVEST : COLA_GREEN;
    stampTemplate(grid, t, CX - Math.floor((t[0].length - 1) / 2), topY);
  }

  function drawSeed(grid) {
    stampTemplate(grid, ['.ee.', 'EeeE', '.ee.'], CX - 2, POT_TOP - 4);
  }

  function buildStage(stage) {
    const grid = emptyGrid();
    drawPot(grid);

    switch (stage) {
      case 0:
        drawSeed(grid);
        break;

      case 1:
        drawSeed(grid);
        plot(grid, CX, POT_TOP - 5, 'g');
        plot(grid, CX, POT_TOP - 6, 'G');
        plot(grid, CX - 1, POT_TOP - 7, 'H');
        plot(grid, CX, POT_TOP - 7, 'h');
        plot(grid, CX + 1, POT_TOP - 7, 'H');
        plot(grid, CX, POT_TOP - 8, 'L');
        break;

      case 2:
        drawStem(grid, POT_TOP - 2, POT_TOP - 9);
        stampTemplate(grid, COTYLEDON, CX - 3, POT_TOP - 12);
        leafRight(grid, POT_TOP - 15, 'sm');
        break;

      case 3:
        drawStem(grid, POT_TOP - 2, POT_TOP - 24);
        leafRight(grid, POT_TOP - 11, 'lg');
        leafLeft(grid, POT_TOP - 17, 'lg');
        leafRight(grid, POT_TOP - 23, 'md');
        plot(grid, CX - 1, POT_TOP - 26, 'H');
        plot(grid, CX, POT_TOP - 27, 'h');
        plot(grid, CX + 1, POT_TOP - 26, 'H');
        break;

      case 4:
        drawStem(grid, POT_TOP - 2, POT_TOP - 28);
        leafLeft(grid, POT_TOP - 13, 'lg');
        leafRight(grid, POT_TOP - 19, 'lg');
        leafLeft(grid, POT_TOP - 25, 'md');
        drawCola(grid, POT_TOP - 38, false);
        break;

      case 5:
      default:
        drawStem(grid, POT_TOP - 2, POT_TOP - 30);
        leafRight(grid, POT_TOP - 13, 'lg');
        leafLeft(grid, POT_TOP - 19, 'lg');
        leafRight(grid, POT_TOP - 25, 'md');
        drawCola(grid, POT_TOP - 40, true);
        plot(grid, CX, POT_TOP - 42, 'T');
        plot(grid, CX - 2, POT_TOP - 43, 't');
        plot(grid, CX + 2, POT_TOP - 43, 't');
        plot(grid, CX, POT_TOP - 44, 'a');
        break;
    }

    return grid;
  }

  function gridToRects(grid) {
    const rects = [];
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const fill = C[grid[y][x]];
        if (fill) rects.push({ x: x, y: y, fill: fill });
      }
    }
    return rects;
  }

  function renderStageSvg(stageIndex, options) {
    const opts = options || {};
    const stage = Math.max(0, Math.min(5, Number(stageIndex) || 0));
    const hero = !!opts.hero;
    const compact = !!opts.compact;
    const animate = !!opts.animate;
    const noBg = !!opts.noBg;
    const uid = 'px' + Math.random().toString(36).slice(2, 8);
    const label = (window.PlantToken && window.PlantToken.GROWTH_STAGES[stage].label) || 'Plant';

    const rects = gridToRects(buildStage(stage));
    const pixelHtml = rects
      .map(function (r) {
        return '<rect class="px" x="' + r.x + '" y="' + r.y + '" width="1" height="1" fill="' + r.fill + '"/>';
      })
      .join('');

    const cls =
      'plant-grow-svg plant-grow-svg--pixel plant-grow-svg--s' +
      stage +
      (hero ? ' plant-grow-svg--hero' : '') +
      (compact ? ' plant-grow-svg--compact' : '') +
      (animate ? ' plant-grow-svg--animate' : '');

    const frame = noBg
      ? ''
      : '<rect class="grow-nft-bg" width="' +
        SIZE +
        '" height="' +
        SIZE +
        '" rx="5" fill="url(#' +
        uid +
        '-bg)"/>' +
        '<rect class="grow-nft-ring" x="2" y="2" width="' +
        (SIZE - 4) +
        '" height="' +
        (SIZE - 4) +
        '" rx="4" fill="none" stroke="url(#' +
        uid +
        '-ring)" stroke-width="1.2"/>';

    return (
      '<svg class="' +
      cls +
      '" viewBox="0 0 ' +
      SIZE +
      ' ' +
      SIZE +
      '" role="img" aria-label="' +
      label +
      ' stage" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<linearGradient id="' +
      uid +
      '-bg" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#0e1e28"/>' +
      '<stop offset="0.5" stop-color="#0a1418"/>' +
      '<stop offset="1" stop-color="#061018"/>' +
      '</linearGradient>' +
      '<linearGradient id="' +
      uid +
      '-ring" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="rgba(45,212,191,0.5)"/>' +
      '<stop offset="0.5" stop-color="rgba(45,212,191,0.1)"/>' +
      '<stop offset="1" stop-color="rgba(45,212,191,0.4)"/>' +
      '</linearGradient>' +
      '</defs>' +
      frame +
      '<g class="grow-pixel-art" shape-rendering="crispEdges">' +
      pixelHtml +
      '</g>' +
      '</svg>'
    );
  }

  window.PlantPixelSprites = {
    SIZE: SIZE,
    renderStageSvg: renderStageSvg,
    buildStage: buildStage,
  };
})();
