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

  /* Copy rendered from JS goes through the shared dictionary, with the
     English kept here as the fallback so this gate still reads correctly if
     i18n never loaded — it is the one screen nobody may get stuck on. */
  function T(key, en, vars) {
    if (window.I18N && window.I18N.tf) return window.I18N.tf(key, en, vars);
    return String(en).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars && name in vars ? vars[name] : whole;
    });
  }

  /* Stamps the rendered element with its key so a later language switch
     re-translates this dialog in place, without rebuilding it and losing
     the click handlers already bound to its buttons. */
  function key(name, vars, rich) {
    var attr = ' ' + (rich ? 'data-i18n-html' : 'data-i18n') + '="' + name + '"';
    if (vars) attr += " data-i18n-vars='" + JSON.stringify(vars) + "'";
    return attr;
  }

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
      var age = { age: MIN_AGE };
      el.innerHTML =
        '<div class="trust-gate-card">' +
        '<h2 id="age-gate-title"' + key('common.trust.ageTitle', age) + '>' +
        T('common.trust.ageTitle', 'Are you {age} or older?', age) +
        '</h2>' +
        '<p' + key('common.trust.ageBody', age) + '>' +
        T('common.trust.ageBody', 'growtoo is a cannabis cultivation journal and related tools. You must be at least {age} years old to enter. Local laws still apply where you live.', age) +
        '</p>' +
        '<div class="trust-gate-actions">' +
        '<button type="button" class="btn btn-primary" id="age-gate-yes"' + key('common.trust.ageYes', age) + '>' +
        T('common.trust.ageYes', 'I am {age}+', age) +
        '</button>' +
        '<button type="button" class="btn btn-ghost" id="age-gate-no"' + key('common.trust.ageNo', age) + '>' +
        T('common.trust.ageNo', 'I am under {age}', age) +
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
          '<h2' + key('common.trust.deniedTitle') + '>' +
          T('common.trust.deniedTitle', 'Access restricted') +
          '</h2>' +
          '<p' + key('common.trust.deniedBody', { age: MIN_AGE }) + '>' +
          T('common.trust.deniedBody', 'Sorry — growtoo is only for adults {age}+. Please leave this site.', { age: MIN_AGE }) +
          '</p>' +
          '<div class="trust-gate-actions">' +
          '<a class="btn btn-ghost" href="https://www.google.com"' + key('common.trust.leave') + '>' +
          T('common.trust.leave', 'Leave') +
          '</a>' +
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
      '<h2 id="cookie-banner-title"' + key('common.cookies.title', null, true) + '>' +
      T('common.cookies.title', 'Cookies &amp; local data') +
      '</h2>' +
      '<p' + key('common.cookies.body', { href: privacyHref }, true) + '>' +
      T('common.cookies.body', 'We use essential storage for sign-in and your journal preferences. Optional analytics help us improve the product. See the <a href="{href}">Privacy Policy</a>.', { href: privacyHref }) +
      '</p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn btn-primary" id="cookie-accept-all"' + key('common.cookies.acceptAll') + '>' +
      T('common.cookies.acceptAll', 'Accept all') +
      '</button>' +
      '<button type="button" class="btn btn-ghost" id="cookie-essential"' + key('common.cookies.essential') + '>' +
      T('common.cookies.essential', 'Essential only') +
      '</button>' +
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

  /* Wait for the dictionary before painting: this gate is the first thing a
     visitor sees, and a flash of English here is the worst place for one. */
  function whenTranslated(fn) {
    if (window.I18N && window.I18N.whenReady) window.I18N.whenReady(fn);
    else fn();
  }

  ready(function () {
    whenTranslated(function () {
      showAgeGate().then(function (ok) {
        if (!ok) return;
        showCookieBanner();
      });
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
