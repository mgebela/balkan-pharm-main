import { adaptForFacebook } from '../platforms/facebook.ts';
import { adaptForInstagram } from '../platforms/instagram.ts';
import { adaptForX } from '../platforms/x.ts';
import type { ContentDraft } from '../types.ts';

export function adaptForPlatforms(masterIdea: string, callToAction?: string): Pick<
  ContentDraft,
  'xVersion' | 'instagramVersion' | 'facebookVersion'
> {
  return {
    xVersion: adaptForX(masterIdea, callToAction),
    instagramVersion: adaptForInstagram(masterIdea, callToAction),
    facebookVersion: adaptForFacebook(masterIdea, callToAction),
  };
}
