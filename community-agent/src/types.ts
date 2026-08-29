export interface ContentDraft {
  topic: string;
  audience: string;
  sourceUrls: string[];
  factualClaims: string[];
  masterIdea: string;
  xVersion?: string;
  instagramVersion?: string;
  facebookVersion?: string;
  callToAction?: string;
  riskFlags: string[];
  approvalStatus: 'pending' | 'approved' | 'rejected';
}

export type FeatureStatus = 'live' | 'devnet' | 'mocked' | 'planned';

export interface ApprovedFact {
  text: string;
  status: FeatureStatus | 'phrase' | 'early';
  source: string;
  date: string;
}

export interface RelevanceScore {
  relevance: number;
  usefulness: number;
  risk: number;
  shouldReply: boolean;
  reasons: string[];
}

export interface ReviewCard {
  draftId: string;
  source: string;
  draft: ContentDraft;
  reasoning: string;
  riskFlags: string[];
  pillar?: string;
  conversationTitle?: string;
}
