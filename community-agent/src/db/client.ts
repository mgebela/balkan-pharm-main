import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir, dbPath } from '../paths.ts';
import { emptyDatabase, type MemoryDatabase } from './schema.ts';

export function loadDatabase(): MemoryDatabase {
  try {
    const raw = readFileSync(dbPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<MemoryDatabase>;
    return {
      conversations: parsed.conversations ?? [],
      drafts: parsed.drafts ?? [],
      people: parsed.people ?? [],
      learnings: parsed.learnings ?? [],
    };
  } catch {
    return emptyDatabase();
  }
}

export function saveDatabase(db: MemoryDatabase): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(dbPath(), `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isoWeek(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function todayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}
