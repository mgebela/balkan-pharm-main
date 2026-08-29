import type { ContentDraft, RelevanceScore } from '../types.ts';

export interface ConversationRecord {
  id: string;
  platform: string;
  url: string;
  author?: string;
  title: string;
  excerpt: string;
  discoveredAt: string;
  scores: RelevanceScore;
}

export interface DraftRecord extends ContentDraft {
  id: string;
  createdAt: string;
  conversationId?: string;
  pillar?: string;
  reasoning: string;
}

export interface PersonRecord {
  handle: string;
  platform: string;
  topics: string[];
  lastExchangeAt?: string;
  notes?: string;
}

export interface LearningRecord {
  id: string;
  week: string;
  topic: string;
  whatWorked: string;
  createdAt: string;
}

export interface MemoryDatabase {
  conversations: ConversationRecord[];
  drafts: DraftRecord[];
  people: PersonRecord[];
  learnings: LearningRecord[];
}

export function emptyDatabase(): MemoryDatabase {
  return {
    conversations: [],
    drafts: [],
    people: [],
    learnings: [],
  };
}
