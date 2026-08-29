# growtoo community agent

Drafts Facebook-first posts, then waits for approval. It posts to the growtoo Page only after you approve and a Page token is stored locally.

This Cursor chat cannot log into Facebook. Publishing uses the official Graph API from your machine.

```
npm install
cp .env.example .env   # then add FACEBOOK_PAGE_ACCESS_TOKEN locally
npm run daily -- --no-reddit
npx tsx src/cli.ts approve <id>
npx tsx src/cli.ts publish <id> --facebook
npx tsx src/cli.ts publish <id> --facebook --at 2026-09-01T10:00:00
```

## Connect Facebook (once)

1. Open [developers.facebook.com/apps](https://developers.facebook.com/apps) and create an app (type **Business** or **Other**). Name it something like growtoo community.
2. Open **Tools → Graph API Explorer**.
3. Select that app. Get a **User** token with:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
4. Run `GET /me/accounts`. Find the growtoo Page (`61594092954687`) and copy its `access_token`.
5. Put it only in `community-agent/.env` as `FACEBOOK_PAGE_ACCESS_TOKEN`. Never paste it into chat or commit it.

In Development mode this works for Page admins of the app. Do not put the app through Ads review. Organic Page posts are enough.

Do not ask the agent to scrape Facebook or post while logged in as you in a browser.

## Approval

No token, and no `--facebook` / `--approved` flag, means nothing is posted.

## Connect X (optional)

Sign in at [console.x.com](https://console.x.com/) as **@growtoo420**. Create a project and app, set permissions to **Read and Write**, then copy these into `community-agent/.env`:

- `X_API_KEY` / `X_API_SECRET` (Consumer Keys)
- `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` (user tokens for @growtoo420)

`X_BEARER_TOKEN` is optional and cannot post. New X apps are usually pay-per-use — check the console before loading credits.

`publish --x` is not wired yet. Filling `.env` only stores the keys. Keep copy-pasting X posts until we add that command.
