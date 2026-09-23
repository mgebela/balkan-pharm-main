/**
 * Landing — retro-poster accent, behaviour half.
 *
 * Pairs with styles/landing-retro.css. One job: gild the last word of
 * marked headings after i18n writes them with textContent (which would
 * wipe any span left in the markup). The marketing site switches language
 * in place, so this also re-runs on i18n:change.
 */
(function (window, document) {
  'use strict';

  function accentHeadings(scope) {
    var els = (scope || document).querySelectorAll('[data-retro-accent]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      /* Flatten a previous pass so a language switch can re-gild. */
      if (el.querySelector('.retro-accent')) el.textContent = el.textContent;

      var words = (el.textContent || '').trim().split(/\s+/);
      if (words.length < 2) continue;

      var last = words.pop();
      el.textContent = words.join(' ') + ' ';
      var span = document.createElement('span');
      span.className = 'retro-accent';
      span.textContent = last;
      el.appendChild(span);
    }
  }

  function boot() {
    accentHeadings(document);
  }

  if (window.I18N && typeof window.I18N.whenReady === 'function') {
    window.I18N.whenReady(boot);
    if (typeof window.I18N.onChange === 'function') window.I18N.onChange(boot);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window, document);
