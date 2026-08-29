import { isoWeek, loadDatabase, saveDatabase, todayStamp } from '../db/client.ts';
import type { ConversationRecord, DraftRecord, LearningRecord, PersonRecord } from '../db/schema.ts';
import type { ApprovedFact } from '../types.ts';
import { loadConfig } from '../load-config.ts';

export interface MemorySnapshot {
  facts: ApprovedFact[];
  phrases: string[];
  recentDrafts: DraftRecord[];
  recentConversations: ConversationRecord[];
  people: PersonRecord[];
  learnings: LearningRecord[];
  recentTopics: string[];
}

export function loadMemory(): MemorySnapshot {
  const config = loadConfig();
  const db = loadDatabase();
  const recentDrafts = [...db.drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  return {
    facts: config.facts,
    phrases: config.phrases,
    recentDrafts,
    recentConversations: [...db.conversations]
      .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt))
      .slice(0, 24),
    people: db.people,
    learnings: db.learnings,
    recentTopics: recentDrafts.map((draft) => draft.topic),
  };
}

export function rememberConversation(record: ConversationRecord): void {
  const db = loadDatabase();
  const existing = db.conversations.findIndex((item) => item.url === record.url);
  if (existing >= 0) db.conversations[existing] = record;
  else db.conversations.push(record);
  saveDatabase(db);
}

export function rememberDraft(record: DraftRecord): DraftRecord {
  const db = loadDatabase();
  const existing = db.drafts.findIndex((item) => item.id === record.id);
  if (existing >= 0) db.drafts[existing] = record;
  else db.drafts.push(record);
  saveDatabase(db);
  return record;
}

export function getDraft(id: string): DraftRecord | undefined {
  return loadDatabase().drafts.find((draft) => draft.id === id);
}

export function listPendingDrafts(): DraftRecord[] {
  return loadDatabase().drafts.filter((draft) => draft.approvalStatus === 'pending');
}

export function rememberPerson(person: PersonRecord): void {
  const db = loadDatabase();
  const existing = db.people.findIndex((item) => item.handle === person.handle && item.platform === person.platform);
  if (existing >= 0) db.people[existing] = { ...db.people[existing], ...person };
  else db.people.push(person);
  saveDatabase(db);
}

export function rememberLearning(learning: Omit<LearningRecord, 'id' | 'createdAt' | 'week'> & { week?: string }): void {
  const db = loadDatabase();
  db.learnings.push({
    id: `learn_${todayStamp()}_${db.learnings.length + 1}`,
    week: learning.week ?? isoWeek(),
    topic: learning.topic,
    whatWorked: learning.whatWorked,
    createdAt: new Date().toISOString(),
  });
  saveDatabase(db);
}

export function unusedPillar(pillarIds: string[]): string | undefined {
  const used = new Set(loadMemory().recentTopics);
  return pillarIds.find((id) => !used.has(id)) ?? pillarIds[0];
}
