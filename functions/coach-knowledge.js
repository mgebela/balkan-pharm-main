/*
 * Lightweight knowledge grounding for the Grow Coach.
 *
 * Matches the grower's message (+ current plant stage) against curated
 * cultivation docs in functions/knowledge/ and returns the most relevant
 * sections to inject into the model's context. Still no embeddings or vector
 * store — retrieval is BM25 over stemmed tokens, with Croatian queries bridged
 * to English terms first.
 *
 * Known ceiling: this is lexical matching, so it finds sections that share
 * words with the question, not sections that share meaning. It reliably lands
 * in the right topic (yellowing → the deficiency doc) but cannot always rank
 * the exact right section first — "lower leaves" vs "new growth" separates
 * nitrogen from sulfur, and only the bridged position terms make that work at
 * all. Since MAX_SECTIONS sections are passed to the model, being in the right
 * neighbourhood is usually enough. Embeddings are the real fix if diagnosis
 * accuracy ever needs to be better than that.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const MAX_SECTIONS = 3;
const MAX_CHARS_PER_SECTION = 1200;

/*
 * Croatian → English query bridge.
 *
 * Scoring is raw token overlap against an English corpus, so a Croatian
 * question ("zašto su mi žuti donji listovi?") tokenised to Croatian words and
 * scored zero against every section — the grounding layer was effectively off
 * for the app's primary language. Expanding the query with English equivalents
 * fixes that without translating the corpus or adding a vector store.
 *
 * Croatian is heavily inflected and the tokenizer does no stemming, so common
 * case/number forms are listed explicitly rather than relying on a stem.
 */
const HR_EN_TERMS = {
  // symptoms / colour
  žuti: ['yellow', 'yellowing', 'chlorosis'], žute: ['yellow', 'yellowing'],
  žuto: ['yellow'], žutilo: ['yellowing', 'chlorosis'],
  smeđe: ['brown', 'necrosis'], smeđi: ['brown', 'necrosis'],
  ljubičasta: ['purple'], ljubičasti: ['purple'],
  mrlje: ['spots', 'spotting', 'lesions'], pjege: ['spots', 'spotting'],
  rubovi: ['edges', 'margins', 'tips'], vrhovi: ['tips', 'edges'],
  uvijaju: ['curl', 'curling', 'clawing'], uvijanje: ['curl', 'curling'],
  venu: ['wilt', 'wilting', 'droop'], venuće: ['wilt', 'wilting'],
  suši: ['dry', 'drying'], sušenje: ['drying', 'cure', 'curing'],
  // position and age — these decide the diagnosis. "Lower/older leaves first"
  // means a mobile nutrient (N, P, K, Mg); "new growth at the top" means an
  // immobile one (Ca, S, Fe, B). Without these the coach cannot tell them apart.
  donji: ['lower', 'bottom', 'older'], donje: ['lower', 'bottom', 'older'],
  dolje: ['lower', 'bottom'], dno: ['bottom', 'lower'],
  gornji: ['upper', 'top', 'new'], gornje: ['upper', 'top', 'new'],
  gore: ['upper', 'top'], vrh: ['top', 'tips'],
  stari: ['older', 'old'], stariji: ['older', 'old'], stare: ['older', 'old'],
  mladi: ['new', 'young'], mlade: ['new', 'young'],
  novi: ['new'], nove: ['new'], novo: ['new'],
  srednji: ['middle'], cijela: ['whole', 'entire'], cijele: ['whole', 'entire'],
  // plant parts
  list: ['leaf', 'leaves'], listovi: ['leaves', 'leaf'], listova: ['leaves', 'leaf'],
  lišće: ['leaves', 'foliage'], korijen: ['root', 'roots'], korijena: ['root', 'roots'],
  stabljika: ['stem', 'stalk'], grana: ['branch'], grane: ['branches'],
  cvijet: ['flower', 'bud'], cvjetovi: ['flowers', 'buds'], pupoljci: ['buds'],
  // nutrition
  gnojivo: ['nutrient', 'fertiliser', 'feed'], gnojiva: ['nutrient', 'fertiliser'],
  gnojidba: ['feeding', 'nutrient'], hranjiva: ['nutrients'],
  dušik: ['nitrogen'], fosfor: ['phosphorus'], kalij: ['potassium'],
  magnezij: ['magnesium'], kalcij: ['calcium'], željezo: ['iron'],
  nedostatak: ['deficiency'], manjak: ['deficiency'], višak: ['excess', 'toxicity'],
  pregorijevanje: ['burn', 'nutrient burn'],
  // water / medium
  zalijevanje: ['watering', 'water'], zalijevati: ['watering', 'water'],
  voda: ['water'], vode: ['water'], prelijevanje: ['overwatering'],
  supstrat: ['substrate', 'medium', 'soil'], zemlja: ['soil', 'medium'],
  tlo: ['soil'], lonac: ['pot', 'container'], drenaža: ['drainage', 'runoff'],
  // environment
  temperatura: ['temperature', 'temp'], vlaga: ['humidity'], vlažnost: ['humidity'],
  svjetlo: ['light'], svjetla: ['light'], rasvjeta: ['light', 'lighting'],
  ventilacija: ['airflow', 'ventilation'], zrak: ['air', 'airflow'],
  toplina: ['heat'], hladno: ['cold'], mraz: ['frost'],
  // pests / disease
  štetnici: ['pests', 'pest'], grinje: ['mites', 'spider mites'],
  lisne: ['aphids'], uši: ['aphids'], plijesan: ['mold', 'mould', 'botrytis'],
  buđ: ['mold', 'mould'], trulež: ['rot', 'botrytis'], gljivice: ['fungus', 'fungal'],
  bolest: ['disease', 'illness', 'pests'], bolesti: ['disease', 'illness'],
  simptom: ['symptom'], simptomi: ['symptoms'], trips: ['thrips'],
  tripsi: ['thrips'], tripsa: ['thrips'],
  // practice
  rezidba: ['pruning', 'topping'], orezivanje: ['pruning', 'defoliation'],
  presađivanje: ['transplant', 'repot'], berba: ['harvest'], žetva: ['harvest'],
  prinos: ['yield'], sorta: ['strain', 'cultivar'], sjeme: ['seed', 'seeds'],
  vanjski: ['outdoor'], vani: ['outdoor'], unutarnji: ['indoor'],
  smola: ['resin', 'trichomes'], trihomi: ['trichomes'],
};

/**
 * Add English equivalents for any Croatian terms in the query.
 *
 * @param {!Set<string>} tokens Tokens from the grower's message.
 * @return {!Set<string>} Tokens plus bridged English terms.
 */
function withCroatianBridge(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    const mapped = HR_EN_TERMS[t];
    if (mapped) for (const m of mapped) out.add(m);
  }
  return out;
}

const STAGE_ALIASES = {
  klijanje: ['germination', 'klijanje', 'seed', 'sprout'],
  sadnica: ['seedling', 'sadnica'],
  vegetativna: ['vegetative', 'veg', 'vegetativna'],
  cvjetanje: ['flowering', 'flower', 'bloom', 'cvjetanje'],
  susenje: ['drying', 'dry', 'cure', 'curing', 'harvest', 'susenje'],
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'my', 'me', 'i', 'to', 'of', 'and', 'or',
  'it', 'in', 'on', 'for', 'do', 'does', 'did', 'can', 'should', 'what', 'why', 'how',
  'this', 'that', 'plant', 'today', 'log', 'please', 'help', 'with',
]);

/** @type {{title: string, heading: string, body: string, file: string}[]|null} */
let sectionCache = null;
/** @type {Map<string, number>} */
let docFreq = new Map();
let totalSections = 0;
let avgSectionLength = 0;

/*
 * Crude suffix stripper. Not linguistics — just enough that "defoliating",
 * "defoliation" and "defoliate" land on the same key, which raw token equality
 * did not. Applied identically to queries and corpus, so consistency matters
 * more than correctness; over-stemming a word is harmless as long as both
 * sides stem the same way. Croatian terms are bridged to English before
 * scoring, so this only has to handle English morphology.
 */
const SUFFIX_RULES = [
  [/ations$/, 'at'], [/ation$/, 'at'],
  [/ings$/, ''], [/ing$/, ''],
  [/ies$/, 'y'], [/ied$/, 'y'],
  [/ed$/, ''], [/es$/, ''], [/s$/, ''],
];

function stem(word) {
  let w = word;
  if (w.length > 4) {
    for (const [re, rep] of SUFFIX_RULES) {
      if (re.test(w) && w.replace(re, rep).length >= 4) {
        w = w.replace(re, rep);
        break;
      }
    }
  }
  // Trailing "e" last, so "defoliate" meets "defoliat" from the rules above.
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/**
 * Words as written — the Croatian bridge keys are raw, so lookup happens here.
 *
 * @param {string} text Source text.
 * @return {!Array<string>} Unstemmed tokens.
 */
function tokenizeRaw(text) {
  return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9čćžšđ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function tokenize(text) {
  return tokenizeRaw(text).map(stem);
}

function loadSections() {
  if (sectionCache) return sectionCache;
  const sections = [];
  let files = [];
  try {
    files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  } catch (err) {
    console.warn('coach-knowledge: no knowledge dir', err && err.message);
    sectionCache = [];
    return sectionCache;
  }
  for (const file of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
    } catch (err) {
      continue;
    }
    // Split on "## " headings; keep the "# " doc title as a prefix for context.
    const docTitleMatch = raw.match(/^#\s+(.+)$/m);
    const docTitle = docTitleMatch ? docTitleMatch[1].trim() : file;
    const parts = raw.split(/\n(?=##\s)/g);
    for (const part of parts) {
      const headingMatch = part.match(/^##\s+(.+)$/m);
      if (!headingMatch) continue; // skip the doc-title-only preamble chunk
      const heading = headingMatch[1].trim();
      const body = part.trim();
      sections.push({
        title: docTitle,
        heading,
        body: body.slice(0, MAX_CHARS_PER_SECTION),
        file,
        tokens: termFreq(tokenize(heading + ' ' + body)),
      });
    }
  }
  // Document frequency + average length, for the BM25 scoring below.
  docFreq = new Map();
  let lengthSum = 0;
  for (const s of sections) {
    s.length = [...s.tokens.values()].reduce((a, b) => a + b, 0);
    lengthSum += s.length;
    for (const t of s.tokens.keys()) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  totalSections = sections.length;
  avgSectionLength = lengthSum / (sections.length || 1);
  sectionCache = sections;
  return sections;
}

/**
 * Count occurrences per term.
 *
 * @param {!Array<string>} tokens Stemmed tokens.
 * @return {!Map<string, number>} Term frequencies.
 */
function termFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * BM25 relevance.
 *
 * Plain token overlap weighted every word equally, so "flowering" (in most
 * sections) counted as much as "ppfd" (in one) and generic sections won
 * specific questions. Weighting purely by rarity then overcorrected: a single
 * incidental rare word — "THC *climbs* through flowering" — outranked several
 * on-topic common ones.
 *
 * BM25 balances the two: rare terms score higher, repeated terms saturate
 * rather than accumulate without limit, and longer sections do not win on
 * length alone.
 *
 * @param {!Object} section Section with a term-frequency map.
 * @param {!Set<string>} queryTokens Stemmed query terms.
 * @return {number} Relevance score.
 */
function bm25(section, queryTokens) {
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const t of queryTokens) {
    const tf = section.tokens.get(t);
    if (!tf) continue;
    const df = docFreq.get(t) || 0;
    if (!df) continue;
    const idf = Math.log(1 + (totalSections - df + 0.5) / (df + 0.5));
    const norm = 1 - b + (b * section.length) / (avgSectionLength || 1);
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
  }
  return score;
}

/**
 * @param {string} message - the grower's latest chat message
 * @param {string} [stageKey] - current focus plant's stage key (klijanje|sadnica|...)
 * @return {string} formatted knowledge block, or '' if nothing matched well
 */
function getRelevantKnowledge(message, stageKey) {
  const sections = loadSections();
  if (!sections.length) return '';

  // Bridge on raw words (HR_EN_TERMS keys are unstemmed), then stem everything.
  const bridged = withCroatianBridge(new Set(tokenizeRaw(message)));
  const queryTokens = new Set([...bridged].map(stem));
  const stageWords = STAGE_ALIASES[stageKey] || [];

  const scored = sections
      .map((s) => {
        let score = bm25(s, queryTokens);
        const headingLower = s.heading.toLowerCase();
        for (const w of stageWords) {
          if (headingLower.includes(w)) score += 1;
        }
        return {section: s, score};
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SECTIONS);

  if (!scored.length) return '';

  const blocks = scored.map(
      (x) => `From "${x.section.title}" — ${x.section.heading}:\n${x.section.body}`,
  );
  return (
    'Relevant cultivation reference (use this to ground your advice; ' +
    'don\'t just repeat it verbatim, apply it to the grower\'s specific situation):\n\n' +
    blocks.join('\n\n---\n\n')
  );
}

module.exports = {getRelevantKnowledge};
