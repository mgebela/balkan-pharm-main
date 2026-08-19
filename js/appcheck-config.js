/*
 * Firebase App Check — shared configuration.
 *
 * The Firebase web apiKey is a public project identifier, not a secret, so
 * anyone can point a script straight at Firestore and the Cloud Functions and
 * bypass the UI entirely. App Check is what makes "this request came from our
 * app" true; the Firestore rules then decide what that caller may do.
 *
 * Load this BEFORE any firebase initializeApp() call. It is a classic script
 * (not a module) so it runs ahead of deferred `<script type="module">` blocks.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * 1. Firebase console → App Check → register the web app with reCAPTCHA
 *    Enterprise, and create the matching key in Google Cloud → reCAPTCHA.
 * 2. Paste the *site* key below. Like the apiKey it is public and belongs in
 *    source; the secret half stays in Google Cloud.
 * 3. Deploy and watch App Check → Metrics. Only flip enforcement on once
 *    "verified" covers essentially all traffic, or you will lock out live
 *    users mid-session.
 *
 * Until the key is set, every call here is a no-op and nothing changes.
 */
(function () {
  'use strict';

  // Public reCAPTCHA Enterprise site key (growto.live). Empty = App Check stays off.
  window.GROWTOO_APPCHECK_SITE_KEY = '6LcGIY4tAAAAAFK2amIu2B-QRIWZkcOHARBnvui_';

  var host = window.location.hostname;
  var isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '' || host === '[::1]';

  // Local dev has no reCAPTCHA domain registration. This makes the SDK print a
  // debug token to the console; register it under App Check → Manage debug
  // tokens to work against the real backend. Never reached in production.
  if (isLocal) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  /**
   * True when App Check should be initialised at all.
   * @return {boolean} Whether a site key is configured.
   */
  window.growtooAppCheckEnabled = function () {
    return !!window.GROWTOO_APPCHECK_SITE_KEY;
  };

  /**
   * Initialise App Check on the compat SDK. Safe to call when unconfigured or
   * when the App Check bundle failed to load — it simply does nothing.
   *
   * App Check must never be the reason the app fails to start, so every
   * failure here is logged and swallowed rather than thrown.
   */
  window.growtooInitAppCheckCompat = function () {
    try {
      if (!window.GROWTOO_APPCHECK_SITE_KEY) return;
      if (!window.firebase || !window.firebase.appCheck) return;
      window.firebase.appCheck().activate(
          new window.firebase.appCheck.ReCaptchaEnterpriseProvider(
              window.GROWTOO_APPCHECK_SITE_KEY,
          ),
          true, // auto-refresh tokens
      );
    } catch (err) {
      console.warn('App Check init skipped', err);
    }
  };

  /**
   * Headers for Cloud Function fetch() calls: JSON + optional App Check +
   * Firebase ID token. Safe when App Check is off or the user is signed out.
   * @param {Object=} extra Extra header fields.
   * @return {Promise<Object>}
   */
  window.growtooFunctionHeaders = function (extra) {
    var headers = Object.assign({'Content-Type': 'application/json'}, extra || {});
    function withAppCheck() {
      try {
        if (!window.GROWTOO_APPCHECK_SITE_KEY) return Promise.resolve();
        if (!window.firebase || !window.firebase.appCheck) return Promise.resolve();
        return window.firebase
            .appCheck()
            .getToken(false)
            .then(function (result) {
              if (result && result.token) {
                headers['X-Firebase-AppCheck'] = result.token;
              }
            })
            .catch(function () {
              /* monitor mode — missing token is logged server-side */
            });
      } catch (err) {
        return Promise.resolve();
      }
    }
    function withAuth() {
      try {
        if (window.firebase && firebase.auth && firebase.auth().currentUser) {
          return firebase.auth().currentUser.getIdToken().then(function (token) {
            if (token) headers.Authorization = 'Bearer ' + token;
            return headers;
          });
        }
      } catch (err) {
        /* ignore */
      }
      return Promise.resolve(headers);
    }
    return withAppCheck().then(withAuth);
  };
})();
