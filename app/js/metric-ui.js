/*
 * Shared metric card UI (trading-dashboard style) for Dashboard + Adopt views.
 */
(function () {
  'use strict';

  /** Equalizer bars — pct drives overall energy; pattern keeps a readable EQ shape. */
  function metricEqHtml(pct, color) {
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    const energy = Math.max(0.12, p / 100);
    const peaks = [0.38, 0.72, 1, 0.58, 0.86];
    const bars = peaks
      .map(function (peak, i) {
        const h = Math.round(Math.max(0.14, peak * energy) * 100);
        const delay = (i * 0.08).toFixed(2) + 's';
        return (
          '<span class="metric-eq-bar" style="--eq-h:' +
          h +
          '%;--eq-color:' +
          (color || '#2dd4bf') +
          ';--eq-delay:' +
          delay +
          '"></span>'
        );
      })
      .join('');
    return '<div class="metric-eq" aria-hidden="true">' + bars + '</div>';
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
    const chartSrc = o.eq || o.donut;
    const chart =
      chartSrc != null
        ? '<div class="metric-card-chart">' + metricEqHtml(chartSrc.pct, chartSrc.color) + '</div>'
        : '';
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
    eq: metricEqHtml,
    /** @deprecated alias — cards now render equalizer bars */
    donut: metricEqHtml,
    row: metricRow,
    card: metricCard,
    panel: metricPanel,
  };
})();
