import type { PlatformAdapter } from './types.ts';

export const FACEBOOK_CHAR_LIMIT = 2000;
export const FACEBOOK_PAGE_PUBLIC_ID = '61594092954687';

export function adaptForFacebook(masterIdea: string, callToAction?: string): string {
  const body = masterIdea.trim();
  const extra = callToAction && !body.includes(callToAction) ? `\n\n${callToAction}` : '';
  return clip(`${body}${extra}`, FACEBOOK_CHAR_LIMIT);
}

export function validateFacebook(text: string): string[] {
  const flags: string[] = [];
  if (text.length > FACEBOOK_CHAR_LIMIT) flags.push(`facebook-over-limit:${text.length}`);
  if (/buy now|limited time|act fast/i.test(text)) flags.push('facebook-hype');
  return flags;
}

export const facebookAdapter: PlatformAdapter = {
  id: 'facebook',
  label: 'Facebook',
  charLimit: FACEBOOK_CHAR_LIMIT,
  adapt: adaptForFacebook,
  validate: validateFacebook,
};

export interface FacebookPublishInput {
  message: string;
  scheduledAt?: Date;
}

export interface FacebookPublishResult {
  id: string;
  url: string;
  scheduled: boolean;
}

export function facebookCredentials(): { pageId: string; token: string; version: string } {
  const pageId = process.env.FACEBOOK_PAGE_ID ?? FACEBOOK_PAGE_PUBLIC_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? '';
  const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
  if (!token) {
    throw new Error(
      'Facebook publishing needs FACEBOOK_PAGE_ACCESS_TOKEN in community-agent/.env. Do not paste the token into chat.',
    );
  }
  return { pageId, token, version };
}

export async function publishToFacebook(input: FacebookPublishInput): Promise<FacebookPublishResult> {
  const message = input.message.trim();
  if (!message) throw new Error('Facebook post body is empty');
  const flags = validateFacebook(message);
  if (flags.length) throw new Error(`Facebook post blocked: ${flags.join(', ')}`);

  const { pageId, token, version } = facebookCredentials();
  const body = new URLSearchParams({ message, access_token: token });

  if (input.scheduledAt) {
    const unix = Math.floor(input.scheduledAt.getTime() / 1000);
    const min = Math.floor(Date.now() / 1000) + 10 * 60;
    if (unix < min) throw new Error('Facebook schedule time must be at least 10 minutes from now');
    body.set('published', 'false');
    body.set('scheduled_publish_time', String(unix));
  }

  const response = await fetch(`https://graph.facebook.com/${version}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message ?? `Facebook Graph error ${response.status}`);
  }

  const postId = json.id.includes('_') ? json.id.split('_')[1] : json.id;
  return {
    id: json.id,
    url: `https://www.facebook.com/${pageId}/posts/${postId}`,
    scheduled: Boolean(input.scheduledAt),
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}
