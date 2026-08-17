/**
 * Stack same strain+stage plants/tokens/listings into expandable card rows.
 * Used by Plants journal, Tokenise garden, and Market grids.
 */
(function (root) {
  'use strict';

  var STAGE_BUCKET = {
    klijanje: 'germination',
    sadnica: 'seedling',
    vegetativna: 'vegetative',
    cvjetanje: 'flowering',
    susenje: 'harvest',
    seed: 'seed',
    germination: 'germination',
    seedling: 'seedling',
    vegetative: 'vegetative',
    flowering: 'flowering',
    harvest: 'harvest',
  };

  /* [dictionary key, English] — resolved in stageLabel(), because this
     table is built while the page parses, before the dictionary lands. */
  var STAGE_LABEL = {
    seed: ['app.stage.seed', 'Seed'],
    germination: ['app.stage.germination', 'Germination'],
    seedling: ['app.stage.seedling', 'Seedling'],
    vegetative: ['app.stage.vegetative', 'Vegetative'],
    flowering: ['app.stage.flowering', 'Flowering'],
    harvest: ['app.stage.harvest', 'Harvest'],
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stageBucket(raw) {
    var key = String(raw == null ? '' : raw)
      .trim()
      .toLowerCase();
    if (STAGE_BUCKET[key]) return STAGE_BUCKET[key];
    if (/harvest|susenje|dry/i.test(key)) return 'harvest';
    if (/flower|cvjet/i.test(key)) return 'flowering';
    if (/veget/i.test(key)) return 'vegetative';
    if (/seedling|sadnic/i.test(key)) return 'seedling';
    if (/germin|klij/i.test(key)) return 'germination';
    if (/seed/i.test(key)) return 'seed';
    return key || 'growing';
  }

  function stageLabel(bucket) {
    var row = STAGE_LABEL[bucket];
    if (row) return T(row[0], row[1]);
    return bucket || T('app.stage.growing', 'Growing');
  }

  /** Strip "· Row 12" / "· Cohort 3" / "· Plant 1" suffixes for grouping. */
  function displayStem(name) {
    return String(name || '')
      .replace(/\s*[·•|-]\s*(row|cohort|plant|specimen|seed)\s*#?\s*\d+\s*$/i, '')
      .replace(/\s+#\d+\s*$/i, '')
      .trim();
  }

  function normalizeStrain(strain, name) {
    var s = String(strain || '')
      .trim()
      .toLowerCase();
    if (s) return s;
    return displayStem(name).toLowerCase();
  }

  function groupKey(opts) {
    var o = opts || {};
    var strain = normalizeStrain(o.strain, o.name);
    var stage = stageBucket(o.stage);
    var seller = o.sellerUid ? String(o.sellerUid) : '';
    return strain + '|' + stage + (seller ? '|' + seller : '');
  }

  /**
   * @param {Array} items
   * @param {{ getStrain, getName, getStage, getSeller, getWeight, getId }} accessors
   * @returns {Array<{ key, strain, name, stage, size, members }>}
   */
  function groupItems(items, accessors) {
    var acc = accessors || {};
    var getStrain = acc.getStrain || function (x) {
      return x && x.strain;
    };
    var getName = acc.getName || function (x) {
      return x && x.name;
    };
    var getStage = acc.getStage || function (x) {
      return x && x.stage;
    };
    var getSeller = acc.getSeller || function () {
      return '';
    };
    var getWeight = acc.getWeight || function () {
      return 1;
    };
    var map = Object.create(null);
    var order = [];
    (items || []).forEach(function (item, index) {
      if (!item) return;
      var name = getName(item) || '';
      var strain = getStrain(item) || '';
      var stage = getStage(item) || '';
      var seller = getSeller(item) || '';
      var key = groupKey({ strain: strain, name: name, stage: stage, sellerUid: seller });
      if (!map[key]) {
        map[key] = {
          key: key,
          strain: String(strain || displayStem(name) || T('app.stack.plant', 'Plant')).trim(),
          name: displayStem(name) || String(strain || T('app.stack.plant', 'Plant')).trim(),
          stage: stageBucket(stage),
          size: 0,
          members: [],
        };
        order.push(key);
      }
      var weight = Math.max(1, Number(getWeight(item, index)) || 1);
      map[key].size += weight;
      map[key].members.push(item);
    });
    return order.map(function (k) {
      return map[k];
    });
  }

  function shouldStack(group) {
    if (!group || !group.members || !group.members.length) return false;
    if (group.members.length > 1) return true;
    return Number(group.size || 0) > 1;
  }

  /**
   * Wrap member cards in an expandable stack when size > 1.
   * @param {object} group
   * @param {string} membersHtml — pre-rendered member card HTML
   * @param {{ surface?: string, photo?: string, meta?: string }} opts
   */
  function wrapStackHtml(group, membersHtml, opts) {
    var o = opts || {};
    if (!shouldStack(group)) return membersHtml;
    var rows = group.members.length;
    var plants = Number(group.size || rows) || rows;
    var meta =
      o.meta ||
      (group.strain ? esc(group.strain) + ' · ' : '') +
        esc(stageLabel(group.stage)) +
        ' · ' +
        (rows > 1 ? rows + ' rows · ' : '') +
        plants +
        ' plant' +
        (plants === 1 ? '' : 's');
    var photo = o.photo
      ? '<div class="plant-stack-photo"><img src="' + esc(o.photo) + '" alt="" /></div>'
      : '';
    var layers = Math.min(3, Math.max(1, rows));
    var layerHtml = '';
    for (var i = layers - 1; i >= 1; i -= 1) {
      layerHtml +=
        '<span class="plant-stack-layer plant-stack-layer--' + i + '" aria-hidden="true"></span>';
    }
    return (
      '<details class="plant-stack plant-stack--' +
      esc(o.surface || 'plants') +
      '" data-stack-key="' +
      esc(group.key) +
      '" data-stage-key="' +
      esc(group.stage) +
      '">' +
      '<summary class="plant-stack-face">' +
      '<div class="plant-stack-deck" aria-hidden="true">' +
      layerHtml +
      '<span class="plant-stack-layer plant-stack-layer--top"></span>' +
      '</div>' +
      photo +
      '<div class="plant-stack-copy">' +
      '<div class="plant-stack-title-row">' +
      '<h3 class="plant-stack-title">' +
      esc(group.name || group.strain || T('app.stack.plants', 'Plants')) +
      '</h3>' +
      '<span class="plant-stack-count" title="' +
      esc(T('app.stack.countTitle', '{count} plants in this stack', { count: plants })) +
      '">×' +
      esc(String(plants)) +
      '</span>' +
      '</div>' +
      '<p class="plant-stack-meta">' +
      meta +
      '</p>' +
      '<p class="plant-stack-hint">' +
      esc(T('app.stack.tapToOpen', 'Tap to open stack')) +
      '</p>' +
      '</div>' +
      '</summary>' +
      '<div class="plant-stack-members">' +
      membersHtml +
      '</div>' +
      '</details>'
    );
  }

  function firstPhoto(members, getPhoto) {
    var fn =
      getPhoto ||
      function (m) {
        return m && m.photo;
      };
    for (var i = 0; i < (members || []).length; i += 1) {
      var p = fn(members[i]);
      if (p) return p;
    }
    return '';
  }

  root.GrowtooStacks = {
    stageBucket: stageBucket,
    stageLabel: stageLabel,
    displayStem: displayStem,
    groupKey: groupKey,
    groupItems: groupItems,
    shouldStack: shouldStack,
    wrapStackHtml: wrapStackHtml,
    firstPhoto: firstPhoto,
  };
})(typeof window !== 'undefined' ? window : globalThis);
