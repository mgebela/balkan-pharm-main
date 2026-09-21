/**
 * Journal — retro-poster accent layer, behaviour half.
 *
 * Pairs with app/styles/journal-retro.css. Two jobs, both additive: gild the
 * last word of marked headings, and turn the Today card's one-line brief into
 * the poster's terminal log plus a boxed coach note.
 *
 * Deliberately a separate file with a single call site in app.js, so the whole
 * treatment comes out by removing the link, the script, and the body class.
 */
(function (window, document) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function T(key, en, vars) {
    return typeof window.T === 'function' ? window.T(key, en, vars) : en;
  }

  // ── gold last word ─────────────────────────────────────────

  /**
   * The poster sets the last word of a headline in gold. It has to happen
   * after i18n, which writes headings with textContent and would wipe any
   * span left in the markup. Doing it here also means it lands in every
   * language without putting markup into the locale files.
   */
  function accentHeadings(scope) {
    var els = (scope || document).querySelectorAll('[data-retro-accent]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.querySelector('.retro-accent')) continue;

      var words = (el.textContent || '').trim().split(/\s+/);
      /* A one-word heading would turn gold in its entirety, which reads as a
         different treatment rather than an accent. Leave those alone. */
      if (words.length < 2) continue;

      var last = words.pop();
      el.textContent = words.join(' ') + ' ';
      var span = document.createElement('span');
      span.className = 'retro-accent';
      span.textContent = last;
      el.appendChild(span);
    }
  }

  // ── today's log ────────────────────────────────────────────

  var ICONS = {
    water: '<path d="M12 3.5s5.5 6 5.5 9.5a5.5 5.5 0 01-11 0C6.5 9.5 12 3.5 12 3.5z"/>',
    feed: '<path d="M9.5 3h5M10.5 3v5l-4 8.6A2 2 0 008.3 19.5h7.4a2 2 0 001.8-2.9L13.5 8V3"/><path d="M8 14h8"/>',
    stage: '<path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/>',
    photo: '<rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6.5l1-2h4l1 2"/>',
  };

  var CHECK = '<path d="M5 12.5l5 5 9-10"/>';

  var ROWS = [
    { key: 'water', label: 'Watered', labelKey: 'app.retro.watered', types: ['zalijevanje'] },
    { key: 'feed', label: 'Fed (nutrients)', labelKey: 'app.retro.fed', types: ['gnojidba'] },
    { key: 'stage', label: 'Growth stage', labelKey: 'app.retro.stage', types: ['faza', 'podfaza'] },
    { key: 'photo', label: 'Photo taken', labelKey: 'app.retro.photo', types: null },
  ];

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function ymd(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /* Entries carry a user-chosen `date` and a real `createdAt`; the rest of the
     app reads `date || createdAt`, so the log agrees with the journal even
     when a grower backdates something. */
  function dayOf(entry) {
    var raw = entry.date || entry.createdAt;
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return String(raw).slice(0, 10);
    var ms = Date.parse(raw);
    return isNaN(ms) ? '' : ymd(new Date(ms));
  }

  function clockOf(entry) {
    var ms = Date.parse(entry.createdAt || entry.date || '');
    if (isNaN(ms)) return '';
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** Day number of the longest-running plant, for the [ DAY n ] counter. */
  function dayNumber(plants) {
    var oldest = 0;
    (plants || []).forEach(function (p) {
      if (!p || !p.startDate) return;
      var ms = Date.parse(p.startDate);
      if (isNaN(ms)) return;
      if (!oldest || ms < oldest) oldest = ms;
    });
    if (!oldest) return 0;
    var days = Math.floor((Date.now() - oldest) / 86400000);
    return days < 0 ? 0 : days + 1;
  }

  function plantNameFor(plants, id) {
    var hit = (plants || []).filter(function (p) {
      return p && String(p.id) === String(id);
    })[0];
    return hit ? hit.name || '' : '';
  }

  function rowHtml(row, hit, plants) {
    var done = !!hit;
    var detail;
    if (done) {
      var bits = [];
      var clock = clockOf(hit);
      if (clock) bits.push(clock);
      var name = plantNameFor(plants, hit.plantId);
      if (name) bits.push(name);
      detail = bits.join(' · ');
    } else {
      detail = T('app.retro.notYet', 'Not logged yet');
    }

    return (
      '<li class="retro-log-row' + (done ? '' : ' retro-log-row--pending') + '">' +
      '<span class="retro-log-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + ICONS[row.key] + '</svg>' +
      '</span>' +
      '<span class="retro-log-body">' +
      '<span class="retro-log-label">' + escapeHtml(T(row.labelKey, row.label)) + '</span>' +
      '<span class="retro-log-time">' + escapeHtml(detail) + '</span>' +
      '</span>' +
      '<span class="retro-log-mark" role="img" aria-label="' +
      escapeHtml(done ? T('app.retro.done', 'Logged') : T('app.retro.pending', 'Not logged')) +
      '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + CHECK + '</svg>' +
      '</span>' +
      '</li>'
    );
  }

  /**
   * Paint the terminal log and the coach note into the Today card. Additive:
   * app.js still writes the plain line and the action buttons, so every
   * existing handler keeps working and the CSS just hides the sentence that
   * the coach note now carries.
   */
  function paintTodayCard(o) {
    var card = document.getElementById('dashboard-today-card');
    if (!card || !document.body.classList.contains('journal-retro')) return false;

    var opts = o || {};
    var plants = opts.plants || [];
    var today = ymd(new Date());
    var mine = (opts.entries || []).filter(function (e) {
      return e && dayOf(e) === today;
    });

    var rows = ROWS.map(function (row) {
      var hit = mine.filter(function (e) {
        return row.types ? row.types.indexOf(e.type) >= 0 : !!e.photo;
      })[0];
      return rowHtml(row, hit, plants);
    }).join('');

    var day = dayNumber(plants);
    var html =
      '<div class="retro-log">' +
      '<div class="retro-log-head">' +
      '<p class="retro-log-title">' +
      escapeHtml(T('app.retro.todaysLog', 'Today’s log')) +
      '</p>' +
      (day
        ? '<span class="retro-log-day">[ ' +
          escapeHtml(T('app.retro.day', 'Day {n}', { n: day })) +
          ' ]</span>'
        : '') +
      '</div>' +
      '<ul class="retro-log-rows">' + rows + '</ul>' +
      '<p class="retro-log-plate">' +
      escapeHtml(T('app.retro.plate', 'growtoo terminal · model GJ-50')) +
      '</p>' +
      '</div>';

    var brief = String(opts.brief || '').trim();
    if (brief) {
      html +=
        '<div class="retro-coach">' +
        '<p class="retro-coach-head">' +
        escapeHtml(T('app.retro.coachNote', 'Coach note:')) +
        '</p>' +
        '<div class="retro-coach-body">' +
        '<p class="retro-coach-line">' + escapeHtml(brief) + '</p>' +
        '<span class="retro-coach-rule" aria-hidden="true"></span>' +
        '</div>' +
        '</div>';
    }

    /* Re-render on every pass rather than patching in place — the card is
       repainted whenever plants or entries change. */
    card.querySelectorAll('.retro-log, .retro-coach').forEach(function (el) {
      el.parentNode.removeChild(el);
    });

    var anchor = document.getElementById('dashboard-today-line');
    var frag = document.createElement('div');
    frag.innerHTML = html;
    while (frag.firstChild) {
      if (anchor) card.insertBefore(frag.firstChild, anchor);
      else card.appendChild(frag.firstChild);
    }
    return true;
  }

  window.JournalRetro = {
    accentHeadings: accentHeadings,
    paintTodayCard: paintTodayCard,
  };

  /* Headings are static markup, so one pass after the dictionary lands is
     enough — a language switch reloads the app (data-i18n-reload). */
  if (window.I18N && typeof window.I18N.whenReady === 'function') {
    window.I18N.whenReady(function () {
      accentHeadings(document);
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      accentHeadings(document);
    });
  } else {
    accentHeadings(document);
  }
})(window, document);
