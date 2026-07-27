/*
 * Shared metric card UI for Dashboard + Adopt views.
 */
(function () {
  'use strict';

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
    row: metricRow,
    card: metricCard,
    panel: metricPanel,
  };
})();
