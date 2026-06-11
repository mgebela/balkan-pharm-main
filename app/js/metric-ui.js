/*
 * Shared metric card UI (trading-dashboard style) for Dashboard + Adopt views.
 */
(function () {
  'use strict';

  function metricDonutSvg(pct, color) {
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    const r = 17;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - p / 100);
    return (
      '<svg class="metric-donut" viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="metric-donut-track" cx="22" cy="22" r="' +
      r +
      '"/>' +
      '<circle class="metric-donut-fill" cx="22" cy="22" r="' +
      r +
      '" stroke="' +
      color +
      '" stroke-dasharray="' +
      c.toFixed(2) +
      '" stroke-dashoffset="' +
      offset.toFixed(2) +
      '"/>' +
      '</svg>'
    );
  }

  function metricRow(label, value, dotClass) {
    return (
      '<div class="metric-row">' +
      '<span class="metric-dot ' +
      (dotClass || 'metric-dot--muted') +
      '"></span>' +
      '<span class="metric-row-label">' +
      label +
      '</span>' +
      '<span class="metric-row-val">' +
      value +
      '</span>' +
      '</div>'
    );
  }

  function metricCard(opts) {
    const o = opts || {};
    const chart = o.donut != null ? '<div class="metric-card-chart">' + metricDonutSvg(o.donut.pct, o.donut.color) + '</div>' : '';
    return (
      '<article class="metric-card' +
      (o.modifier ? ' metric-card--' + o.modifier : '') +
      '">' +
      '<div class="metric-card-body">' +
      '<span class="metric-card-label">' +
      (o.label || '') +
      '</span>' +
      '<div class="metric-card-value">' +
      (o.value != null ? o.value : '—') +
      '</div>' +
      (o.meta ? '<div class="metric-card-meta">' + o.meta + '</div>' : '') +
      '</div>' +
      chart +
      '</article>'
    );
  }

  function metricPanel(title, cardsHtml, extraClass) {
    return (
      '<div class="metric-panel' +
      (extraClass ? ' ' + extraClass : '') +
      '">' +
      (title ? '<header class="metric-panel-head"><h2 class="metric-panel-title">' + title + '</h2></header>' : '') +
      '<div class="metric-cards">' +
      cardsHtml +
      '</div></div>'
    );
  }

  window.MetricUI = {
    donut: metricDonutSvg,
    row: metricRow,
    card: metricCard,
    panel: metricPanel,
  };
})();
