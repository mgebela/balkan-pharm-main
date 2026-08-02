/*
 * In-app confirm sheet — replaces window.confirm for Market / Tokenise flows.
 * Usage: const ok = await AppConfirm.ask({ title, body, confirmLabel, danger });
 */
(function () {
  'use strict';

  let pending = null;
  let bound = false;
  let lastFocus = null;

  function els() {
    return {
      overlay: document.getElementById('app-confirm-overlay'),
      title: document.getElementById('app-confirm-title'),
      body: document.getElementById('app-confirm-body'),
      ok: document.getElementById('app-confirm-ok'),
      cancel: document.getElementById('app-confirm-cancel'),
      backdrop: document.getElementById('app-confirm-backdrop'),
      sheet: document.querySelector('#app-confirm-overlay .app-confirm-sheet'),
    };
  }

  function finish(result) {
    const ui = els();
    if (ui.overlay) ui.overlay.hidden = true;
    document.body.classList.remove('app-confirm-open');
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(!!result);
    }
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus();
      } catch (_) {
        /* ignore */
      }
    }
    lastFocus = null;
  }

  function bindOnce() {
    if (bound) return;
    const ui = els();
    if (!ui.overlay || !ui.ok || !ui.cancel) return;
    bound = true;

    ui.ok.addEventListener('click', function () {
      finish(true);
    });
    ui.cancel.addEventListener('click', function () {
      finish(false);
    });
    // Dragging the sheet away reads as Cancel, same as backdrop/Escape.
    var handle = document.querySelector('#app-confirm-overlay .app-confirm-handle');
    if (handle && ui.sheet && window.SheetDrag) {
      SheetDrag.attach(handle, ui.sheet, {
        onDismiss: function () {
          finish(false);
        },
      });
    }
    if (ui.backdrop) {
      ui.backdrop.addEventListener('click', function () {
        finish(false);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (!ui.overlay || ui.overlay.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
  }

  function setBody(ui, body) {
    if (!ui.body) return;
    ui.body.textContent = '';
    const text = body == null ? '' : String(body);
    if (!text) return;
    text.split(/\n+/).forEach(function (para) {
      const p = para.trim();
      if (!p) return;
      const el = document.createElement('p');
      el.textContent = p;
      ui.body.appendChild(el);
    });
  }

  /**
   * @param {{
   *   title?: string,
   *   body?: string,
   *   confirmLabel?: string,
   *   cancelLabel?: string,
   *   danger?: boolean
   * }} opts
   * @returns {Promise<boolean>}
   */
  function ask(opts) {
    opts = opts || {};
    bindOnce();
    const ui = els();

    if (!ui.overlay || !ui.ok || !ui.cancel || !ui.title) {
      const fallback =
        (opts.title ? opts.title + '\n\n' : '') + (opts.body || 'Continue?');
      return Promise.resolve(window.confirm(fallback));
    }

    if (pending) finish(false);

    lastFocus = document.activeElement;
    ui.title.textContent = opts.title || 'Confirm';
    setBody(ui, opts.body || '');
    ui.ok.textContent = opts.confirmLabel || 'Confirm';
    ui.cancel.textContent = opts.cancelLabel || 'Cancel';
    ui.ok.classList.toggle('btn-danger', !!opts.danger);
    ui.ok.classList.toggle('btn-primary', !opts.danger);
    if (ui.sheet) {
      ui.sheet.classList.toggle('app-confirm-sheet--danger', !!opts.danger);
    }

    ui.overlay.hidden = false;
    document.body.classList.add('app-confirm-open');

    return new Promise(function (resolve) {
      pending = resolve;
      requestAnimationFrame(function () {
        try {
          ui.ok.focus();
        } catch (_) {
          /* ignore */
        }
      });
    });
  }

  window.AppConfirm = { ask: ask };
})();
