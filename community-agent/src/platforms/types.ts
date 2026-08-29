import type { ContentDraft } from '../types.ts';

export type SocialPlatform = 'x' | 'instagram' | 'facebook';
export type DiscoveryPlatform = SocialPlatform | 'reddit' | 'web';

export interface PublicConversation {
  platform: DiscoveryPlatform;
  url: string;
  author?: string;
  title: string;
  excerpt: string;
  publishedAt?: string;
}

export interface PlatformAdapter {
  id: SocialPlatform;
  label: string;
  charLimit: number;
  adapt(masterIdea: string, callToAction?: string): string;
  validate(text: string): string[];
}

export type { ContentDraft };
