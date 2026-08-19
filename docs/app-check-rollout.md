# App Check rollout

The Firebase web `apiKey` is a public project identifier, not a secret. Without
App Check, anyone can point a script straight at Firestore and the Cloud
Functions and skip the UI entirely — the Firestore rules are then the only thing
standing there. App Check attests that a request came from our app; the rules
still decide what that caller may do. The two are complementary.

The code is already in place. Step 2 (site key) is done; clients send tokens.
Nothing is rejected until step 4.

## What is already wired

| Piece | Where | State |
| --- | --- | --- |
| Shared client config | `js/appcheck-config.js` | site key set; monitor mode |
| Landing (compat SDK) | `index.html` | initialises after `initializeApp` |
| App (compat SDK) | `app/index.html` | same |
| Sign-in (modular SDK) | `dnevnik/index.html` | same |
| Admin (modular SDK) | `app/js/admin.js` + 5 admin pages | same |
| Server verification | `functions/user-guards.js` → `verifyAppCheck()` | monitor mode |
| Endpoints verified | `coachChat`, `analyzeGrowFrames`, `solanaRpc`, `linkWallet` | monitor mode |
| Client Function headers | `window.growtooFunctionHeaders()` | ID token + App Check when the site key is set |
| HTTP ops (settle/reconcile/kick) | Firebase ID token **or** `GROWTOO_OPS_SECRET` | required after Functions deploy |

Every client init is wrapped in try/catch. App Check must never be the reason
the app fails to start.

`onRequest` functions are **not** covered by the console's enforcement toggle —
that only applies to callable functions — which is why enforcement lives in
`verifyAppCheck()` behind the `APP_CHECK_ENFORCE` env var.

## Step 1 — register (console)

1. Google Cloud → Security → reCAPTCHA → create a key, type **Website**,
   for `growto.live` (add `localhost` for local testing).
2. Firebase console → App Check → Apps → register the web app with
   **reCAPTCHA Enterprise**, using that key.

## Step 2 — turn the client on

Paste the **site** key into `js/appcheck-config.js`:

```js
window.GROWTOO_APPCHECK_SITE_KEY = '6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
```

It is public, like the `apiKey` — the secret half stays in Google Cloud. Bump
the `?v=` on the `appcheck-config.js` script tags (5 admin pages + 3 entry
points) so returning users are not served a cached empty key.

Deploy. Clients now send tokens; nothing is rejected yet.

## Step 3 — watch (do not skip)

Firebase console → App Check → Metrics, and the function logs:

```bash
gcloud functions logs read --region europe-west1 --limit 200 | grep appcheck
```

Monitor-mode logs are structured JSON:

```json
{"event":"appcheck","endpoint":"coachChat","reason":"appcheck_missing","enforcing":false}
```

Wait until `appcheck_missing` / `appcheck_invalid` fall to roughly zero. Users
with an open tab keep the old bundle until they reload, so give this **at least
a few days**. Enforcing early logs people out mid-session.

## Step 4 — enforce

Two independent switches — do them one at a time and watch between:

1. **Functions**: set `APP_CHECK_ENFORCE=true` on the Cloud Run services, then
   redeploy. `verifyAppCheck()` starts returning 401.
2. **Firestore**: Firebase console → App Check → APIs → Cloud Firestore →
   Enforce.

To roll back, unset `APP_CHECK_ENFORCE` (or un-enforce in the console). Both
revert to monitor mode immediately; no code change needed.

## Local development

`js/appcheck-config.js` sets `FIREBASE_APPCHECK_DEBUG_TOKEN = true` on
localhost, so the SDK prints a debug token to the console. Register it under
App Check → Manage debug tokens to work against the real backend. Never fires
in production — it is gated on hostname.

## What App Check does not do

It attests the **app**, not the **user**. A determined attacker can still drive
a real browser. It raises the cost of scripted abuse; it does not replace:

- `requireVerifiedUser()` — who the caller is
- `consumeDailyQuota()` — how much they may spend
- Firestore rules — what they may touch

Tests for the guards: `cd functions && npm test`.
