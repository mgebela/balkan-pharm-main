import type { ContentPillar } from '../load-config.ts';
import type { PublicConversation } from '../platforms/types.ts';

export const DISCOVERY_CAP = 8;

const BLOCKED_HOST_HINTS = ['mail.google', 'docs.google', 'drive.google', 'facebook.com/messages', 'instagram.com/direct'];

export interface DiscoveryInput {
  urls?: string[];
  conversations?: PublicConversation[];
  pillars?: ContentPillar[];
  enableReddit?: boolean;
  limit?: number;
}

interface RedditChild {
  data?: {
    title?: string;
    selftext?: string;
    permalink?: string;
    author?: string;
    created_utc?: number;
    subreddit?: string;
    over_18?: boolean;
  };
}

function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return !BLOCKED_HOST_HINTS.some((hint) => parsed.host.includes(hint) || parsed.href.includes(hint));
  } catch {
    return false;
  }
}

async function fetchPublicPage(url: string): Promise<PublicConversation | null> {
  if (!isPublicUrl(url)) return null;
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'growtoo-community-agent/0.1 (+https://growto.live)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
    const excerpt =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ??
      '';
    return {
      platform: hostPlatform(url),
      url,
      title: decode(title).slice(0, 180),
      excerpt: decode(excerpt).slice(0, 400),
    };
  } catch {
    return {
      platform: hostPlatform(url),
      url,
      title: url,
      excerpt: '',
    };
  }
}

function hostPlatform(url: string): PublicConversation['platform'] {
  if (/x\.com|twitter\.com/i.test(url)) return 'x';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com/i.test(url)) return 'facebook';
  if (/reddit\.com/i.test(url)) return 'reddit';
  return 'web';
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function searchReddit(query: string, limit: number): Promise<PublicConversation[]> {
  const endpoint = new URL('https://www.reddit.com/search.json');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('sort', 'new');
  endpoint.searchParams.set('limit', String(Math.min(limit, 5)));
  endpoint.searchParams.set('raw_json', '1');

  const response = await fetch(endpoint, {
    headers: { 'user-agent': 'growtoo-community-agent/0.1 (+https://growto.live; public search only)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data?: { children?: RedditChild[] } };
  return (json.data?.children ?? [])
    .map((child) => child.data)
    .filter((post): post is NonNullable<RedditChild['data']> => Boolean(post?.permalink && post.title))
    .filter((post) => post.author !== '[deleted]' && !post.over_18)
    .map((post) => ({
      platform: 'reddit' as const,
      url: `https://www.reddit.com${post.permalink}`,
      author: post.author,
      title: post.title ?? '',
      excerpt: (post.selftext ?? '').slice(0, 400),
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
    }))
    .filter((post) => post.title && post.url !== 'https://www.reddit.comundefined');
}

export async function discoverConversations(input: DiscoveryInput = {}): Promise<PublicConversation[]> {
  const limit = Math.min(input.limit ?? DISCOVERY_CAP, DISCOVERY_CAP);
  const found: PublicConversation[] = [...(input.conversations ?? [])];

  for (const url of input.urls ?? []) {
    const page = await fetchPublicPage(url);
    if (page) found.push(page);
    if (found.length >= limit) break;
  }

  const redditEnabled = input.enableReddit ?? process.env.GROWTOO_SKIP_REDDIT !== '1';
  if (redditEnabled && found.length < limit) {
    const queries = (input.pillars ?? []).flatMap((pillar) => pillar.searchQueries).slice(0, 3);
    for (const query of queries) {
      try {
        const posts = await searchReddit(query, limit - found.length);
        found.push(...posts);
      } catch {
        // Public search is best-effort. Seeds and pasted URLs still work.
      }
      if (found.length >= limit) break;
    }
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    if (!isPublicUrl(item.url) || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, limit);
}
