/*
 * Fit the grower journal snapshot into the coach prompt without losing the
 * fields the prompt actually depends on.
 *
 * The old approach was `JSON.stringify(context).slice(0, 6000)`, which fails in
 * two ways: it cuts mid-JSON so the model receives a malformed object, and it
 * cuts from the end — where `toolboxRecent`, `reminders` and `mintQuest` live.
 * COACH_SYSTEM has a whole paragraph telling the model to ground its advice in
 * `toolboxRecent`'s real readings, so the busier the grower, the more reliably
 * that instruction had nothing to work with. A realistic 12-plant snapshot
 * measured 5,862 chars against the 6,000 cap — a 2% margin.
 *
 * Instead: order small high-value fields first, then trim the long arrays
 * element by element until the whole thing fits. Output is always valid JSON.
 */
'use strict';

// ~5k tokens. Generous next to a Flash-class context window, and large enough
// that trimming is rare rather than routine. Override without a redeploy.
const DEFAULT_MAX_CHARS = Number(process.env.COACH_CONTEXT_MAX_CHARS || 20000);

// Small, high-signal, and cheap to keep — emitted before anything trimmable.
const PRIORITY_FIELDS = [
  'focusPlant',
  'toolboxRecent',
  'toolboxCounts',
  'weather',
  'reminders',
  'mintQuest',
  'growSetup',
  'growStyleNote',
];

// Long arrays, in the order they give up elements. Entries are the most
// redundant (many similar waterings); plants are the most contextual, so they
// shrink last.
const TRIMMABLE_FIELDS = ['tokens', 'recentEntries', 'plants'];

/**
 * Assemble the snapshot in priority order.
 *
 * @param {!Object} context Raw context from the client.
 * @param {!Object<string, number>} limits Per-field array caps.
 * @return {!Object} Ordered snapshot.
 */
function assemble(context, limits) {
  const out = {};
  for (const key of PRIORITY_FIELDS) {
    if (context[key] !== undefined && context[key] !== null) out[key] = context[key];
  }
  for (const key of TRIMMABLE_FIELDS) {
    const arr = context[key];
    if (!Array.isArray(arr)) continue;
    const limit = Math.max(0, limits[key]);
    // Emit the field even when it trims to empty. Omitting it would let the
    // model conclude the grower has never logged anything, which is worse than
    // an empty list next to a count of what was left out.
    out[key] = arr.slice(0, limit);
    if (arr.length > limit) out[key + 'Truncated'] = arr.length - limit;
  }
  // Anything the client added that we don't know about goes last, so a new
  // field can never push a known-important one out.
  for (const key of Object.keys(context)) {
    if (key in out) continue;
    if (PRIORITY_FIELDS.includes(key) || TRIMMABLE_FIELDS.includes(key)) continue;
    out[key] = context[key];
  }
  return out;
}

/**
 * Serialise the journal snapshot to fit a character budget.
 *
 * @param {*} context Raw context object from the client.
 * @param {number} [maxChars] Budget; defaults to COACH_CONTEXT_MAX_CHARS.
 * @return {{json: string, trimmed: boolean, dropped: !Object<string, number>}}
 *   Valid JSON plus what had to be given up.
 */
function buildContextJson(context, maxChars) {
  const budget = Number(maxChars || DEFAULT_MAX_CHARS);
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {json: '{}', trimmed: false, dropped: {}};
  }

  const limits = {};
  for (const key of TRIMMABLE_FIELDS) {
    limits[key] = Array.isArray(context[key]) ? context[key].length : 0;
  }

  let json = JSON.stringify(assemble(context, limits));
  if (json.length <= budget) {
    return {json, trimmed: false, dropped: {}};
  }

  // Always take from whichever array is currently longest. Draining them in a
  // fixed order would wipe out `recentEntries` entirely — the grower's actual
  // activity — while `plants` kept every element. This converges to a
  // comparable sample of each instead.
  const dropped = {};
  let guard = 0;
  while (json.length > budget && guard < 10000) {
    guard += 1;
    const key = TRIMMABLE_FIELDS
        .filter((k) => limits[k] > 0)
        .sort((a, b) => limits[b] - limits[a])[0];
    if (!key) break;
    limits[key] -= 1;
    dropped[key] = (dropped[key] || 0) + 1;
    json = JSON.stringify(assemble(context, limits));
  }

  if (json.length > budget) {
    // Even the priority fields alone overflow — keep the two the prompt leans
    // on hardest rather than emitting something malformed.
    const minimal = {};
    if (context.focusPlant) minimal.focusPlant = context.focusPlant;
    if (context.toolboxRecent) minimal.toolboxRecent = context.toolboxRecent;
    minimal.contextOverflow = true;
    const minimalJson = JSON.stringify(minimal);
    return {
      json: minimalJson.length <= budget ? minimalJson : '{"contextOverflow":true}',
      trimmed: true,
      dropped,
    };
  }

  return {json, trimmed: true, dropped};
}

module.exports = {
  DEFAULT_MAX_CHARS,
  PRIORITY_FIELDS,
  TRIMMABLE_FIELDS,
  buildContextJson,
};
