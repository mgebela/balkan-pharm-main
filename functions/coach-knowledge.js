/*
 * Lightweight knowledge grounding for the Grow Coach.
 * Keyword-matches the grower's message (+ current plant stage) against curated
 * cultivation docs in functions/knowledge/ and returns the most relevant
 * section(s) to inject into the model's context. No embeddings/vector DB —
 * the doc set is small enough that keyword overlap works fine and stays free
 * of an extra service dependency. Revisit with real retrieval if the doc set
 * grows past a few dozen sections.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const MAX_SECTIONS = 2;
const MAX_CHARS_PER_SECTION = 1200;

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

function tokenize(text) {
  return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9čćžšđ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
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
        tokens: tokenize(heading + ' ' + body),
      });
    }
  }
  sectionCache = sections;
  return sections;
}

/**
 * @param {string} message - the grower's latest chat message
 * @param {string} [stageKey] - current focus plant's stage key (klijanje|sadnica|...)
 * @returns {string} formatted knowledge block, or '' if nothing matched well
 */
function getRelevantKnowledge(message, stageKey) {
  const sections = loadSections();
  if (!sections.length) return '';

  const queryTokens = new Set(tokenize(message));
  const stageWords = STAGE_ALIASES[stageKey] || [];

  const scored = sections
      .map((s) => {
        let score = 0;
        for (const t of s.tokens) {
          if (queryTokens.has(t)) score += 1;
        }
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
