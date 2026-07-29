/*
 * In-app plant token sprites — botanical line art (seed → harvest).
 * Alias PlantPixelSprites kept for any older call sites.
 */
(function () {
  'use strict';

  function loadArt() {
    return window.TokenBotanicalArt || null;
  }

  function renderStageSvg(stageIndex, options) {
    const Art = loadArt();
    if (!Art || typeof Art.renderStageSvg !== 'function') return '';
    return Art.renderStageSvg(stageIndex, options);
  }

  var api = {
    SIZE: 200,
    renderStageSvg: renderStageSvg,
    buildStage: function (stageIndex) {
      return renderStageSvg(stageIndex, { showLabel: true });
    },
  };

  window.PlantBotanicalSprites = api;
  window.PlantPixelSprites = api;
})();
