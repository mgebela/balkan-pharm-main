/**
 * growtoo i18n — one runtime for the whole site (landing, pitch, legal, app).
 *
 * Adding a language is a data change, never a code change: add an entry to
 * locales/locales.json and drop the matching locales/<code>/<ns>.json files.
 * The switcher, the <html lang>, the hreflang tags and the Intl formatting
 * all read that manifest, so a new language shows up everywhere at once.
 *
 * Markup contract
 *   <h1 data-i18n="landing.hero.title">Grow it again.</h1>
 *   <p data-i18n-html="landing.hero.lede">Rich <em>copy</em>.</p>
 *   <input data-i18n-attr="placeholder:common.form.email; aria-label:common.form.email" />
 *   <span data-i18n="common.plants" data-i18n-count="3"></span>   → plural-aware
 *   <div data-i18n-switcher></div>                                → language picker
 *
 * The English copy stays in the HTML as the source of truth. A missing key
 * therefore degrades to readable English instead of to a blank element.
 *
 * Script contract
 *   <script src="/js/i18n.js" data-i18n-ns="common,landing"></script>
 * Must be a plain (non-defer, non-async) tag in <head>: the fetch has to be
 * in flight before the body parses, or the first paint is the wrong language.
 */
(function (window, document) {
  'use strict';

  var STORE_KEY = 'growtoo:lang';
  var MANIFEST_FILE = 'locales.json';
  /* How long first paint may wait for a dictionary before we give up and
     show English. A stale-but-visible page beats a blank one. */
  var PAINT_BUDGET_MS = 600;

  var script = document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      return all[all.length - 1];
    })();

  /* /js/i18n.js → /locales/ , and the same for every page depth, because it
     is resolved against the script's own URL rather than the document's. */
  var root = script && script.getAttribute('data-i18n-root');
  var LOCALES_URL = new URL(root || '../locales/', script.src).href;

  /* Dictionaries are fetched with the same ?v= the script tag carries, so
     bumping the script version busts the JSON too. Without this a browser
     happily serves yesterday's dictionary against today's keys, and the new
     ones silently fall back to English. */
  var VERSION = (function () {
    var m = /[?&]v=([^&]+)/.exec(script.src || '');
    return m ? m[1] : '';
  })();

  function localeUrl(path) {
    return LOCALES_URL + path + (VERSION ? '?v=' + encodeURIComponent(VERSION) : '');
  }

  var namespaces = (script.getAttribute('data-i18n-ns') || 'common')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  var state = {
    locale: null,
    manifest: null,
    dicts: {},          // locale → flattened { key: string }
    listeners: [],
    missing: {},
    debug: false,
  };

  // ── manifest helpers ───────────────────────────────────────

  function localeMeta(code) {
    var list = (state.manifest && state.manifest.locales) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].code === code) return list[i];
    }
    return null;
  }

  function known(code) { return !!localeMeta(code); }

  function defaultLocale() {
    return (state.manifest && state.manifest.default) || 'en';
  }

  function fallbackLocale() {
    return (state.manifest && state.manifest.fallback) || 'en';
  }

  // ── locale detection ───────────────────────────────────────

  /* Marketing pages get real URLs (/hr/pitch/investor/) so they can be
     shared and indexed; Netlify rewrites those back onto the English file.
     The app, which is behind auth and never indexed, uses ?lang= + storage. */
  function localeFromPath() {
    var seg = window.location.pathname.split('/')[1];
    return seg && known(seg) ? seg : null;
  }

  function localeFromQuery() {
    var m = /[?&]lang=([a-zA-Z-]+)/.exec(window.location.search);
    var code = m ? m[1].toLowerCase().split('-')[0] : null;
    return code && known(code) ? code : null;
  }

  function localeFromStore() {
    try {
      var code = localStorage.getItem(STORE_KEY);
      return code && known(code) ? code : null;
    } catch (e) { return null; }
  }

  function localeFromBrowser() {
    var langs = window.navigator.languages ||
      [window.navigator.language || window.navigator.userLanguage || ''];
    for (var i = 0; i < langs.length; i++) {
      var code = String(langs[i]).toLowerCase().split('-')[0];
      if (known(code)) return code;
    }
    return null;
  }

  function detect() {
    return localeFromPath() || localeFromQuery() || localeFromStore() ||
      localeFromBrowser() || defaultLocale();
  }

  function remember(code) {
    try { localStorage.setItem(STORE_KEY, code); } catch (e) {}
  }

  // ── dictionary loading ─────────────────────────────────────

  /* Nested JSON is nicer to translate by hand; lookups want a flat map.
     { hero: { title: "x" } } → { "hero.title": "x" } */
  function flatten(obj, prefix, out) {
    out = out || {};
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var path = prefix ? prefix + '.' + key : key;
      var val = obj[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        flatten(val, path, out);
      } else {
        out[path] = val;
      }
    }
    return out;
  }

  function loadNamespace(code, ns) {
    return fetch(localeUrl(code + '/' + ns + '.json'), { credentials: 'omit' })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .catch(function () { return {}; });
  }

  function loadLocale(code) {
    if (state.dicts[code]) return Promise.resolve(state.dicts[code]);
    return Promise.all(namespaces.map(function (ns) {
      return loadNamespace(code, ns);
    })).then(function (parts) {
      var merged = {};
      parts.forEach(function (part, i) {
        flatten(part, namespaces[i], merged);
      });
      state.dicts[code] = merged;
      return merged;
    });
  }

  // ── lookup + formatting ────────────────────────────────────

  function raw(key, code) {
    var dict = state.dicts[code];
    return dict && typeof dict[key] === 'string' ? dict[key] : null;
  }

  function pluralKey(key, count, code) {
    var meta = localeMeta(code);
    var tag = 'other';
    try {
      tag = new Intl.PluralRules(meta ? meta.intl : code).select(count);
    } catch (e) {}
    return key + '_' + tag;
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : whole;
    });
  }

  /**
   * t('landing.hero.title')
   * t('common.plants', { count: 3 })            → plural-aware
   * t('common.greet', { name: 'Bela' })         → "Bok, Bela"
   * Falls back locale → fallback locale → the key itself, and records the
   * miss so scripts/i18n-check.mjs can report it.
   */
  function t(key, vars) {
    var code = state.locale;
    var chain = [code];
    if (chain.indexOf(fallbackLocale()) === -1) chain.push(fallbackLocale());

    var hasCount = vars && typeof vars.count === 'number';
    for (var i = 0; i < chain.length; i++) {
      var hit = hasCount ? raw(pluralKey(key, vars.count, chain[i]), chain[i]) : null;
      if (hit === null) hit = raw(key, chain[i]);
      if (hit !== null) return interpolate(hit, vars);
    }

    if (!state.missing[code]) state.missing[code] = {};
    state.missing[code][key] = true;
    return key;
  }

  /* Numbers, dates and money follow the active locale — 1.234,5 in hr/de,
     1,234.5 in en. Anything Intl can't do falls back to the raw value. */
  function intlTag() {
    var meta = localeMeta(state.locale);
    return meta ? meta.intl : state.locale;
  }

  function n(value, opts) {
    try { return new Intl.NumberFormat(intlTag(), opts).format(value); }
    catch (e) { return String(value); }
  }

  function d(value, opts) {
    var date = value instanceof Date ? value : new Date(value);
    try { return new Intl.DateTimeFormat(intlTag(), opts).format(date); }
    catch (e) { return date.toISOString().slice(0, 10); }
  }

  // ── DOM application ────────────────────────────────────────

  function applyAttrs(el) {
    var spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    spec.split(';').forEach(function (pair) {
      var bits = pair.split(':');
      if (bits.length < 2) return;
      var attr = bits[0].trim();
      var key = bits.slice(1).join(':').trim();
      if (!attr || !key) return;
      var value = t(key, varsFor(el));
      if (value !== key) el.setAttribute(attr, value);
    });
  }

  function varsFor(el) {
    var vars = null;
    var count = el.getAttribute('data-i18n-count');
    if (count !== null && count !== '') {
      vars = vars || {};
      vars.count = Number(count);
    }
    var json = el.getAttribute('data-i18n-vars');
    if (json) {
      try {
        var parsed = JSON.parse(json);
        vars = vars || {};
        for (var k in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, k)) vars[k] = parsed[k];
        }
      } catch (e) {}
    }
    return vars;
  }

  /**
   * Translate a subtree. Safe to call repeatedly and on freshly rendered
   * nodes — that is how JS-built UI stays translated after a re-render.
   */
  function apply(node) {
    var scope = node || document;
    var els = scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]');

    /* querySelectorAll skips the scope element itself, which bites when a
       component translates the very node it just created. */
    var list = [];
    if (scope.nodeType === 1 &&
        (scope.hasAttribute('data-i18n') || scope.hasAttribute('data-i18n-html') ||
         scope.hasAttribute('data-i18n-attr'))) {
      list.push(scope);
    }
    for (var i = 0; i < els.length; i++) list.push(els[i]);

    list.forEach(function (el) {
      applyAttrs(el);

      var key = el.getAttribute('data-i18n');
      var htmlKey = el.getAttribute('data-i18n-html');
      if (!key && !htmlKey) return;

      var value = t(key || htmlKey, varsFor(el));
      if (value === (key || htmlKey)) {
        /* No translation for this key: leave the English already in the
           markup, and mark it when debugging so gaps are visible. */
        if (state.debug) el.setAttribute('data-i18n-miss', '');
        return;
      }
      if (htmlKey) el.innerHTML = value;
      else el.textContent = value;
    });

    renderSwitchers(scope);
    return scope;
  }

  // ── document chrome: lang, hreflang, canonical, og:locale ──

  function localisedPath(code, pathname) {
    var path = pathname || window.location.pathname;
    var parts = path.split('/');
    if (parts[1] && known(parts[1])) parts.splice(1, 1);   // strip existing prefix
    var bare = parts.join('/') || '/';
    if (code === defaultLocale()) return bare;
    return '/' + code + (bare === '/' ? '/' : bare);
  }

  function updateChrome() {
    var meta = localeMeta(state.locale) || {};
    document.documentElement.setAttribute('lang', state.locale);
    document.documentElement.setAttribute('dir', meta.dir || 'ltr');

    var og = document.querySelector('meta[property="og:locale"]');
    if (og && meta.ogLocale) og.setAttribute('content', meta.ogLocale);

    /* Marketing pages only: the app has no indexed URLs to point at. */
    if (document.querySelector('link[rel="canonical"]')) {
      injectHreflang();
    }
  }

  function injectHreflang() {
    var origin = 'https://growto.live';
    var head = document.head;
    var existing = head.querySelectorAll('link[data-i18n-alt]');
    for (var i = 0; i < existing.length; i++) head.removeChild(existing[i]);

    var list = (state.manifest && state.manifest.locales) || [];
    list.forEach(function (meta) {
      var link = document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', meta.code);
      link.setAttribute('href', origin + localisedPath(meta.code));
      link.setAttribute('data-i18n-alt', '');
      head.appendChild(link);
    });

    var xd = document.createElement('link');
    xd.setAttribute('rel', 'alternate');
    xd.setAttribute('hreflang', 'x-default');
    xd.setAttribute('href', origin + localisedPath(defaultLocale()));
    xd.setAttribute('data-i18n-alt', '');
    head.appendChild(xd);
  }

  // ── language switcher ──────────────────────────────────────

  /* Rendered from the manifest, so a new language needs no markup edit on
     any page that already carries a [data-i18n-switcher] slot. */
  function renderSwitchers(scope) {
    var slots = (scope || document).querySelectorAll('[data-i18n-switcher]');
    for (var i = 0; i < slots.length; i++) buildSwitcher(slots[i]);
  }

  function buildSwitcher(slot) {
    var list = (state.manifest && state.manifest.locales) || [];
    if (list.length < 2) return;

    slot.innerHTML = '';
    slot.classList.add('lang-switch');

    var label = document.createElement('span');
    label.className = 'sr-only';
    label.id = 'lang-switch-label-' + Math.random().toString(36).slice(2, 8);
    label.textContent = t('common.lang.label');
    slot.appendChild(label);

    var select = document.createElement('select');
    select.className = 'lang-switch-select';
    select.setAttribute('aria-labelledby', label.id);

    list.forEach(function (meta) {
      var opt = document.createElement('option');
      opt.value = meta.code;
      opt.textContent = meta.nativeName;
      if (meta.code === state.locale) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', function () {
      setLocale(select.value, { navigate: true });
    });

    var face = document.createElement('span');
    face.className = 'lang-switch-face';
    face.setAttribute('aria-hidden', 'true');
    var current = localeMeta(state.locale);
    face.textContent = current ? (current.flag || current.code.toUpperCase()) : '';

    slot.appendChild(select);
    slot.appendChild(face);
  }

  // ── switching ──────────────────────────────────────────────

  /**
   * setLocale('hr')                    → swap in place
   * setLocale('hr', { navigate: true }) → also move to the localised URL
   *
   * Pages that live under a rewritten prefix navigate, so the URL a grower
   * copies out of the address bar opens in the language they were reading.
   */
  function setLocale(code, opts) {
    if (!known(code) || code === state.locale) return Promise.resolve(state.locale);
    remember(code);

    if (opts && opts.navigate && usesPathPrefix()) {
      window.location.href = localisedPath(code) + window.location.search +
        window.location.hash;
      return Promise.resolve(code);
    }

    /* Pages that build most of their UI in JavaScript (the app) cannot be
       re-translated by walking the DOM: half their copy lives in views that
       are not mounted right now, and in strings already written into
       innerHTML. Reloading is the honest way to switch those — the choice is
       stored, so the page comes back in the new language. */
    if (script.hasAttribute('data-i18n-reload')) {
      stampQuery(code);
      window.location.reload();
      return Promise.resolve(code);
    }

    return loadLocale(code).then(function () {
      state.locale = code;
      if (opts && opts.navigate) stampQuery(code);
      updateChrome();
      apply(document);
      state.listeners.forEach(function (fn) {
        try { fn(code); } catch (e) {}
      });
      document.dispatchEvent(new CustomEvent('i18n:change', { detail: { locale: code } }));
      return code;
    });
  }

  /* Real per-language URLs exist only where the /hr/* rewrite runs: the
     marketing site on Netlify. The app (served from /app/, behind auth) and
     a local dev server have no such rewrite, so those switch in place and
     record the choice in the query string instead. */
  function usesPathPrefix() {
    if (/^\/app(\/|$)/.test(window.location.pathname)) return false;
    var host = window.location.hostname;
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
  }

  /* Keeps the URL shareable when we swap in place rather than navigating. */
  function stampQuery(code) {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    if (code === defaultLocale()) url.searchParams.delete('lang');
    else url.searchParams.set('lang', code);
    window.history.replaceState({}, '', url.toString());
  }

  function onChange(fn) {
    if (typeof fn === 'function') state.listeners.push(fn);
  }

  // ── boot ───────────────────────────────────────────────────

  /* Hide text only while a non-default dictionary is in flight, and only up
     to PAINT_BUDGET_MS. English pages never pay this cost. */
  function holdPaint() {
    var style = document.createElement('style');
    style.id = 'i18n-hold';
    style.textContent = '[data-i18n],[data-i18n-html]{visibility:hidden}';
    (document.head || document.documentElement).appendChild(style);
    window.setTimeout(releasePaint, PAINT_BUDGET_MS);
  }

  function releasePaint() {
    var style = document.getElementById('i18n-hold');
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  function domReady() {
    return new Promise(function (resolve) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { resolve(); });
      } else { resolve(); }
    });
  }

  var ready = fetch(localeUrl(MANIFEST_FILE), { credentials: 'omit' })
    .then(function (res) { return res.json(); })
    .then(function (manifest) {
      state.manifest = manifest;
      state.debug = /[?&]i18n=debug/.test(window.location.search);
      state.locale = detect();
      /* A path prefix or ?lang= is an explicit choice; remember it so the
         next page (and the app) opens the same way. */
      if (localeFromPath() || localeFromQuery()) remember(state.locale);

      if (state.locale !== defaultLocale()) holdPaint();
      return loadLocale(state.locale);
    })
    .then(function () { return domReady(); })
    .then(function () {
      updateChrome();
      apply(document);
      releasePaint();
      document.dispatchEvent(new CustomEvent('i18n:ready', {
        detail: { locale: state.locale },
      }));
      return state.locale;
    })
    .catch(function (err) {
      /* Never let a missing dictionary take the page down: English is
         already in the markup, so we just uncover it. */
      releasePaint();
      state.locale = state.locale || 'en';
      if (window.console) window.console.warn('[i18n] falling back to English:', err);
      return state.locale;
    });

  /**
   * Same as t(), but with the English written at the call site as the
   * fallback. This is how JS-rendered copy migrates safely: the string is
   * still readable in the source, and a key that is missing (or a dictionary
   * that never loaded) degrades to English instead of printing a key name.
   *
   *   tf('common.trust.ageYes', 'I am {age}+', { age: 18 })
   */
  function tf(key, fallback, vars) {
    var hit = t(key, vars);
    return hit === key ? interpolate(fallback, vars) : hit;
  }

  /* JS that renders copy has to wait for the dictionary; this resolves
     immediately if i18n already booted, and still runs if it failed. */
  function whenReady(fn) {
    ready.then(fn, fn);
  }

  window.I18N = {
    t: t,
    tf: tf,
    n: n,
    d: d,
    whenReady: whenReady,
    apply: apply,
    setLocale: setLocale,
    onChange: onChange,
    ready: ready,
    localisedPath: localisedPath,
    get locale() { return state.locale; },
    /* The BCP-47 tag Intl should use for this locale ('hr-HR' for 'hr'). */
    get intl() { return intlTag(); },
    get locales() { return (state.manifest && state.manifest.locales) || []; },
    get missing() { return state.missing; },
  };

  /* Short alias for JS-rendered copy: t('app.plant.sealed') */
  window.t = window.t || t;

  /**
   * The app's scripts render copy from plain string literals. T() is the
   * one-character-cheap way to route those through the dictionary while
   * keeping the English readable at the call site:
   *
   *   toast(T('app.plant.saved', 'Plant saved.'))
   *   status(T('app.upload.progress', 'Uploading {pct}%', { pct: 40 }))
   *
   * It never throws and never returns a key: no dictionary means English.
   */
  window.T = tf;
})(window, document);
