import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facebookCredentials, publishToFacebook } from './facebook.ts';

test('refuses to publish without a Page token', () => {
  const previous = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  assert.throws(() => facebookCredentials(), /FACEBOOK_PAGE_ACCESS_TOKEN/);
  if (previous !== undefined) process.env.FACEBOOK_PAGE_ACCESS_TOKEN = previous;
});

test('refuses a schedule less than 10 minutes away', async () => {
  const previous = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  await assert.rejects(
    () => publishToFacebook({ message: 'Hello growers.', scheduledAt: new Date(Date.now() + 60_000) }),
    /10 minutes/,
  );
  if (previous === undefined) delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  else process.env.FACEBOOK_PAGE_ACCESS_TOKEN = previous;
});
