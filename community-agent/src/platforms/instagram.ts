import type { PlatformAdapter } from './types.ts';

export const INSTAGRAM_CHAR_LIMIT = 2200;

export function adaptForInstagram(masterIdea: string, callToAction?: string): string {
  const paragraphs = splitIdea(masterIdea);
  const lines = [...paragraphs];
  if (callToAction && !masterIdea.includes(callToAction)) lines.push(callToAction);
  lines.push('growtoo is early — Solana Devnet, small tester group, journal works with no wallet.');
  return clip(lines.join('\n\n'), INSTAGRAM_CHAR_LIMIT);
}

export function validateInstagram(text: string): string[] {
  const flags: string[] = [];
  if (text.length > INSTAGRAM_CHAR_LIMIT) flags.push(`instagram-over-limit:${text.length}`);
  const tags = text.match(/#\w+/g) ?? [];
  if (tags.length > 3) flags.push('instagram-hashtag-spam');
  return flags;
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  label: 'Instagram',
  charLimit: INSTAGRAM_CHAR_LIMIT,
  adapt: adaptForInstagram,
  validate: validateInstagram,
};

export function publish(): never {
  throw new Error('Instagram publishing is disabled. Copy an approved draft by hand.');
}

function splitIdea(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 2) return [text];
  return [sentences.slice(0, 2).join(' '), sentences.slice(2).join(' ')];
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}
