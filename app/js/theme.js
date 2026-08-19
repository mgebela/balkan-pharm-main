/**
 * Appearance — light / dark / auto.
 *
 * Light is the product default (sage paper, same as landing). Dark remains
 * the unthemed CSS state: only `light` is ever written to <html data-theme>.
 * That is what lets the first paint be correct before any script runs, and
 * it is why there is no prefers-color-scheme rule in the stylesheets — the
 * OS only gets a say once the grower picks Auto.
 *
 * The preference is stored locally so it applies before Firebase resolves,
 * and mirrored onto the user doc (when signed in) so it follows the grower
 * across devices. Local wins during boot; the doc wins once it arrives.
 *
 * The pre-paint half of this lives inline in the page <head> — see
 * window.__growtooTheme — because a deferred script cannot beat first paint.
 */
(function () {
  var KEY = 'growtoo:appearance';
  var VALID = ['light', 'dark', 'system'];
  var DEFAULT = 'light';
  var boot = window.__growtooTheme || {};
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID.indexOf(v) === -1 ? DEFAULT : v;
    } catch (e) {
      // Private mode / blocked storage — fall back to the default.
      return DEFAULT;
    }
  }

  function resolve(pref) {
    if (pref === 'system') return media.matches ? 'dark' : 'light';
    return pref;
  }

  function paint(pref) {
    if (resolve(pref) === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function syncControl(pref) {
    var opts = document.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < opts.length; i++) {
      opts[i].setAttribute(
        'aria-checked',
        String(opts[i].getAttribute('data-theme-choice') === pref)
      );
    }
  }

  function apply(pref, persist) {
    paint(pref);
    syncControl(pref);
    if (persist) {
      try {
        localStorage.setItem(KEY, pref);
      } catch (e) {
        /* nothing we can do; the in-memory choice still holds for this session */
      }
    }
    window.__growtooTheme = { pref: pref, resolved: resolve(pref) };
  }

  // Only meaningful while Auto is selected, but harmless to keep bound.
  media.addEventListener('change', function () {
    if (read() === 'system') paint('system');
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-choice]');
    if (!btn) return;
    var pref = btn.getAttribute('data-theme-choice');
    if (VALID.indexOf(pref) === -1) return;
    apply(pref, true);
  });

  /** Called by app.js once the user doc is known, so the choice roams. */
  window.growtooApplyTheme = function (pref) {
    if (VALID.indexOf(pref) === -1) return;
    apply(pref, true);
  };

  /** Current preference, for whoever writes the user doc. */
  window.growtooThemePref = read;

  apply(boot.pref || read(), false);
})();
