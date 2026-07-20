/*
 * In-app plant token sprites — uses shared chunky pixel art (seed → harvest).
 */
(function () {
  'use strict';

  function loadArt() {
    return window.TokenPixelArt || null;
  }

  function renderStageSvg(stageIndex, options) {
    const Art = loadArt();
    if (!Art) return '';

    const opts = options || {};
    const stage = Math.max(0, Math.min(5, Number(stageIndex) || 0));
    const hero = !!opts.hero;
    const compact = !!opts.compact;
    const animate = !!opts.animate;
    const noBg = !!opts.noBg;
    const uid = 'px' + Math.random().toString(36).slice(2, 8);
    const label =
      (window.PlantToken &&
        window.PlantToken.GROWTH_STAGES &&
        window.PlantToken.GROWTH_STAGES[stage] &&
        window.PlantToken.GROWTH_STAGES[stage].label) ||
      'Plant';

    const grid = Art.buildStage(stage, { withBg: !noBg, withFrame: !noBg });
    const pixels = Art.gridToPixels(grid);
    const size = Art.SIZE;
    const pixelHtml = pixels
      .map(function (r) {
        return (
          '<rect class="px" x="' +
          r.x +
          '" y="' +
          r.y +
          '" width="1" height="1" fill="' +
          r.color +
          '"/>'
        );
      })
      .join('');

    const cls =
      'plant-grow-svg plant-grow-svg--pixel plant-grow-svg--s' +
      stage +
      (hero ? ' plant-grow-svg--hero' : '') +
      (compact ? ' plant-grow-svg--compact' : '') +
      (animate ? ' plant-grow-svg--animate' : '');

    return (
      '<svg class="' +
      cls +
      '" viewBox="0 0 ' +
      size +
      ' ' +
      size +
      '" role="img" aria-label="' +
      label +
      ' stage" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="grow-pixel-art" shape-rendering="crispEdges">' +
      pixelHtml +
      '</g>' +
      '</svg>'
    );
  }

  window.PlantPixelSprites = {
    SIZE: 32,
    renderStageSvg: renderStageSvg,
    buildStage: function (stageIndex) {
      const Art = loadArt();
      return Art ? Art.buildStage(stageIndex, { withBg: true }) : null;
    },
  };
})();
