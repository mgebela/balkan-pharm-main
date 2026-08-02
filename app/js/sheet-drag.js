/**
 * Drag-to-dismiss for bottom sheets.
 *
 * Every sheet in the app (Log care, More menu, confirm, Coach) already renders a
 * grabber bar, but they were decorative — this makes them real. One shared helper
 * rather than the same pointer maths copied into four files.
 *
 * Usage: SheetDrag.attach(handleEl, sheetEl, { onDismiss, threshold });
 */
(function () {
  'use strict';

  var DEFAULT_THRESHOLD = 90;

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /**
   * Only drag on a real bottom sheet. On wide screens these panels re-centre as
   * dialogs or popovers, where "swipe down to dismiss" is not the expected gesture.
   */
  function isBottomSheet() {
    try {
      return window.matchMedia('(max-width: 768px)').matches;
    } catch (e) {
      return true;
    }
  }

  function attach(handleEl, sheetEl, opts) {
    if (!handleEl || !sheetEl || handleEl.dataset.sheetDragBound === '1') return;
    handleEl.dataset.sheetDragBound = '1';

    var o = opts || {};
    var threshold = typeof o.threshold === 'number' ? o.threshold : DEFAULT_THRESHOLD;
    var startY = 0;
    var dy = 0;
    var dragging = false;

    handleEl.style.touchAction = 'none';
    handleEl.style.cursor = 'grab';

    function reset() {
      sheetEl.style.transition = '';
      sheetEl.style.transform = '';
      dy = 0;
    }

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      if (!isBottomSheet()) return;
      dragging = true;
      startY = e.clientY;
      dy = 0;
      sheetEl.style.transition = 'none';
      handleEl.style.cursor = 'grabbing';
      try {
        handleEl.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }

    function onMove(e) {
      if (!dragging) return;
      // Downward only — an upward drag shouldn't peel the sheet off the top.
      dy = Math.max(0, e.clientY - startY);
      sheetEl.style.transform = 'translateY(' + dy + 'px)';
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      handleEl.style.cursor = 'grab';
      var shouldDismiss = dy > threshold;

      if (!prefersReducedMotion()) {
        sheetEl.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }

      if (shouldDismiss) {
        sheetEl.style.transform = 'translateY(' + Math.max(sheetEl.offsetHeight, dy + 120) + 'px)';
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          reset();
          if (typeof o.onDismiss === 'function') o.onDismiss();
        };
        // transitionend can be missed (reduced motion, interrupted) — always fall back.
        sheetEl.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 320);
      } else {
        sheetEl.style.transform = 'translateY(0px)';
        setTimeout(function () {
          if (!dragging) reset();
        }, 300);
      }
    }

    handleEl.addEventListener('pointerdown', onDown);
    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
    handleEl.addEventListener('pointercancel', onUp);
  }

  window.SheetDrag = { attach: attach };
})();
