import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configDir } from './paths.ts';
import type { ApprovedFact, FeatureStatus } from './types.ts';

export interface ContentPillar {
  id: string;
  summary: string;
  searchQueries: string[];
}

export interface AgentConfig {
  brand: string;
  safety: string;
  productFacts: string;
  contentPillars: string;
  facts: ApprovedFact[];
  phrases: string[];
  pillars: ContentPillar[];
}

function readConfig(name: string): string {
  return readFileSync(path.join(configDir(), name), 'utf8');
}

function parseFactLine(line: string, status: ApprovedFact['status']): ApprovedFact | null {
  const trimmed = line.replace(/^- /, '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split('|').map((part) => part.trim());
  return {
    text: parts[0] ?? trimmed,
    status,
    source: parts[1] ?? 'product-facts.md',
    date: parts[2] ?? '',
  };
}

export function parseProductFacts(markdown: string): { facts: ApprovedFact[]; phrases: string[] } {
  const facts: ApprovedFact[] = [];
  const phrases: string[] = [];
  let section = '';

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      section = line.slice(3).toLowerCase();
      continue;
    }
    if (!line.startsWith('- ')) continue;

    if (section === 'allowed phrases') {
      phrases.push(line.replace(/^- /, '').trim());
      continue;
    }

    const statusMap: Record<string, ApprovedFact['status']> = {
      live: 'live',
      devnet: 'devnet',
      mocked: 'mocked',
      planned: 'planned',
      'early status': 'early',
    };
    const status = statusMap[section];
    if (!status) continue;
    const fact = parseFactLine(line, status);
    if (fact) facts.push(fact);
  }

  return { facts, phrases };
}

export function parsePillars(markdown: string): ContentPillar[] {
  const pillars: ContentPillar[] = [];
  let current: ContentPillar | null = null;

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      if (current) pillars.push(current);
      current = { id: line.slice(3).trim(), summary: '', searchQueries: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Search:')) {
      current.searchQueries = line
        .slice('Search:'.length)
        .split(',')
        .map((query) => query.trim())
        .filter(Boolean);
      continue;
    }
    if (line && !line.startsWith('#') && !line.startsWith('Rotate')) {
      current.summary = current.summary ? `${current.summary} ${line}` : line;
    }
  }
  if (current) pillars.push(current);
  return pillars;
}

export function loadConfig(): AgentConfig {
  const brand = readConfig('brand.md');
  const safety = readConfig('safety.md');
  const productFacts = readConfig('product-facts.md');
  const contentPillars = readConfig('content-pillars.md');
  const { facts, phrases } = parseProductFacts(productFacts);
  return {
    brand,
    safety,
    productFacts,
    contentPillars,
    facts,
    phrases,
    pillars: parsePillars(contentPillars),
  };
}

export function statusLabel(status: FeatureStatus): string {
  if (status === 'live') return 'Live';
  if (status === 'devnet') return 'Solana Devnet';
  if (status === 'mocked') return 'Mocked / test only';
  return 'Planned — not live';
}
