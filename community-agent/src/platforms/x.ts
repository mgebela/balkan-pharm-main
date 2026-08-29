import type { PlatformAdapter } from './types.ts';

export const X_CHAR_LIMIT = 280;

export function adaptForX(masterIdea: string, callToAction?: string): string {
  const sentences = masterIdea.split(/(?<=[.!?])\s+/).filter(Boolean);
  const hook = sentences[0] ?? masterIdea;
  const product = sentences.find((sentence) => /growtoo|journal|devnet/i.test(sentence) && sentence !== hook);
  const honest = sentences.find((sentence) => /early|devnet|small group/i.test(sentence) && sentence !== hook && sentence !== product);
  const cta = callToAction && !masterIdea.includes(callToAction) ? callToAction : undefined;
  return clip([hook, product, honest, cta].filter(Boolean).join(' '), X_CHAR_LIMIT);
}

export function validateX(text: string): string[] {
  const flags: string[] = [];
  if (text.length > X_CHAR_LIMIT) flags.push(`x-over-limit:${text.length}`);
  if ((text.match(/https?:\/\//g) ?? []).length > 1) flags.push('x-too-many-links');
  return flags;
}

export const xAdapter: PlatformAdapter = {
  id: 'x',
  label: 'X',
  charLimit: X_CHAR_LIMIT,
  adapt: adaptForX,
  validate: validateX,
};

export function publish(): never {
  throw new Error('X publishing is disabled. Copy an approved draft by hand.');
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}
