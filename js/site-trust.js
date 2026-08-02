/**
 * growtoo age gate + cookie consent (GDPR-oriented).
 * Essential storage (auth, prefs) always allowed; analytics loads only after opt-in.
 *
 * Age gate is a UX / legal-notice gesture only (localStorage). It is NOT server-side
 * access control — do not treat it as authentication or age verification.
 */
(function () {
  'use strict';

  var AGE_KEY = 'growtoo-age-ok';
  var COOKIE_KEY = 'growtoo-cookie-consent';
  var GA_ID = 'G-HLXHTQP41H';
  var MIN_AGE = 18;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function readConsent() {
    try {
      var raw = localStorage.getItem(COOKIE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {
      // ignore
    }
    return null;
  }

  function writeConsent(analytics) {
    var payload = {
      necessary: true,
      analytics: !!analytics,
      at: new Date().toISOString(),
      v: 1,
    };
    try {
      localStorage.setItem(COOKIE_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
    return payload;
  }

  function ageOk() {
    try {
      return localStorage.getItem(AGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setAgeOk() {
    try {
      localStorage.setItem(AGE_KEY, '1');
    } catch (e) {
      // ignore
    }
  }

  function assetBase() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('site-trust.js') !== -1) {
        return src.replace(/js\/site-trust\.js.*$/, '');
      }
    }
    return '';
  }

  function resolveHref(path) {
    return assetBase() + path.replace(/^\//, '');
  }

  function loadAnalytics() {
    if (window.__growtooGaLoaded) return;
    window.__growtooGaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function ensureBtnStyles(root) {
    if (!root) return;
    root.querySelectorAll('.btn').forEach(function (btn) {
      if (btn.classList.contains('btn-primary') || btn.classList.contains('btn-ghost') || btn.classList.contains('btn-adopter')) {
        return;
      }
    });
  }

  function showAgeGate() {
    if (ageOk()) return Promise.resolve(true);

    return new Promise(function (resolve) {
      var el = document.createElement('div');
      el.className = 'trust-gate';
      el.id = 'age-gate';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'age-gate-title');
      el.innerHTML =
        '<div class="trust-gate-card">' +
        '<h2 id="age-gate-title">Are you ' +
        MIN_AGE +
        ' or older?</h2>' +
        '<p>growtoo is a cannabis cultivation journal and related tools. You must be at least ' +
        MIN_AGE +
        ' years old to enter. Local laws still apply where you live.</p>' +
        '<div class="trust-gate-actions">' +
        '<button type="button" class="btn btn-primary" id="age-gate-yes">I am ' +
        MIN_AGE +
        '+</button>' +
        '<button type="button" class="btn btn-ghost" id="age-gate-no">I am under ' +
        MIN_AGE +
        '</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(el);
      document.body.classList.add('trust-gate-locked');
      ensureBtnStyles(el);

      document.getElementById('age-gate-yes').addEventListener('click', function () {
        setAgeOk();
        el.hidden = true;
        document.body.classList.remove('trust-gate-locked');
        if (el.parentNode) el.parentNode.removeChild(el);
        resolve(true);
      });

      document.getElementById('age-gate-no').addEventListener('click', function () {
        el.innerHTML =
          '<div class="trust-gate-card trust-gate-denied">' +
          '<h2>Access restricted</h2>' +
          '<p>Sorry — growtoo is only for adults ' +
          MIN_AGE +
          '+. Please leave this site.</p>' +
          '<div class="trust-gate-actions">' +
          '<a class="btn btn-ghost" href="https://www.google.com">Leave</a>' +
          '</div>' +
          '</div>';
        resolve(false);
      });
    });
  }

  function showCookieBanner() {
    if (readConsent()) {
      var existing = readConsent();
      if (existing && existing.analytics) loadAnalytics();
      return;
    }

    var privacyHref = resolveHref('privacy/');
    var el = document.createElement('div');
    el.className = 'cookie-banner';
    el.id = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'cookie-banner-title');
    el.innerHTML =
      '<h2 id="cookie-banner-title">Cookies &amp; local data</h2>' +
      '<p>We use essential storage for sign-in and your journal preferences. Optional analytics help us improve the product. See the <a href="' +
      privacyHref +
      '">Privacy Policy</a>.</p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn btn-primary" id="cookie-accept-all">Accept all</button>' +
      '<button type="button" class="btn btn-ghost" id="cookie-essential">Essential only</button>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('cookie-accept-all').addEventListener('click', function () {
      writeConsent(true);
      loadAnalytics();
      el.hidden = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    document.getElementById('cookie-essential').addEventListener('click', function () {
      writeConsent(false);
      el.hidden = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  ready(function () {
    showAgeGate().then(function (ok) {
      if (!ok) return;
      showCookieBanner();
    });
  });

  window.GrowtooTrust = {
    ageOk: ageOk,
    readConsent: readConsent,
    loadAnalyticsIfAllowed: function () {
      var c = readConsent();
      if (c && c.analytics) loadAnalytics();
    },
  };
})();
