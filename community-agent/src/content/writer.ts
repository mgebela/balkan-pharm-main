import type { ApprovedFact } from '../types.ts';
import type { ContentStrategy } from './strategist.ts';

export function writeMasterIdea(strategy: ContentStrategy, facts: ApprovedFact[], phrases: string[]): string {
  const opener = strategy.source
    ? `People keep losing the grow across a notebook, a camera roll, and memory. This thread is circling that problem: ${trim(strategy.source.title, 110)}`
    : trim(strategy.pillar.summary, 220);

  const honest = pickPhrase(phrases, /early|devnet|small group/) ??
    'It’s early. We’re on Solana Devnet, testing with a small group of growers.';
  const journal = pickFact(facts, /free grow journal|journal, coach/) ??
    pickPhrase(phrases, /free grow journal/) ??
    'growtoo is a free grow journal — reminders, weather, an AI coach, photos, stages.';
  const coach = pickPhrase(phrases, /should not replace/) ??
    'An AI coach can read the log and prompt the next check. It should not replace looking at the plant.';

  const body = [opener, journal, coachLimit(strategy, coach), honest].filter(Boolean).join(' ');

  if (strategy.invite === 'none') return collapse(body);
  return collapse(`${body} ${strategy.callToAction ?? ''}`.trim());
}

function coachLimit(strategy: ContentStrategy, coachLine: string): string {
  if (strategy.topic === 'coach' || strategy.topic === 'documentation' || strategy.topic === 'routines') {
    return coachLine;
  }
  return '';
}

function pickFact(facts: ApprovedFact[], pattern: RegExp): string | undefined {
  return facts.find((fact) => pattern.test(fact.text))?.text;
}

function pickPhrase(phrases: string[], pattern: RegExp): string | undefined {
  return phrases.find((phrase) => pattern.test(phrase));
}

function trim(text: string, max: number): string {
  const clean = collapse(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
