/*
 * Journal month calendar — entries + Coach due water/feed + forecast.
 * No separate event store: dots come from journal dates, rings from cadence.
 */
(function () {
  'use strict';

  var STORAGE_VIEW = 'dnevnik-live-journal-view';
  /* Weekday and month names come from Intl in the reader's language rather
     than a hand-kept list: every locale then gets its own names, its own
     abbreviations and its own capitalisation for free. Monday-first, which
     is what growers here expect and what the grid is built around. */
  function intlTag() {
    return (window.I18N && window.I18N.locale) || 'en';
  }

  function weekdayNames() {
    try {
      var fmt = new Intl.DateTimeFormat(intlTag(), { weekday: 'short' });
      var out = [];
      for (var i = 0; i < 7; i++) {
        // 2024-01-01 was a Monday.
        out.push(fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
      }
      return out;
    } catch (e) {
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    }
  }

  function monthName(monthIndex, style) {
    try {
      return new Intl.DateTimeFormat(intlTag(), { month: style || 'long' }).format(
        new Date(Date.UTC(2024, monthIndex, 1))
      );
    } catch (e) {
      return String(monthIndex + 1);
    }
  }

  var cursor = null; // { y, m } 0-based month
  var selectedYmd = null;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function ymdFromParts(y, m, d) {
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function todayYmd() {
    var n = new Date();
    return ymdFromParts(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function parseYmd(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  }

  function addDaysYmd(ymd, days) {
    var p = parseYmd(ymd);
    if (!p) return null;
    var dt = new Date(p.y, p.m, p.d + days);
    return ymdFromParts(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function ensureCursor() {
    if (cursor) return cursor;
    var n = new Date();
    cursor = { y: n.getFullYear(), m: n.getMonth() };
    return cursor;
  }

  function getView() {
    try {
      var v = localStorage.getItem(STORAGE_VIEW);
      return v === 'month' ? 'month' : 'list';
    } catch (e) {
      return 'list';
    }
  }

  function setView(view) {
    var next = view === 'month' ? 'month' : 'list';
    try {
      localStorage.setItem(STORAGE_VIEW, next);
    } catch (e) {
      /* ignore */
    }
    return next;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stackKeyForPlant(plant) {
    var Stacks = window.GrowtooStacks;
    if (Stacks && typeof Stacks.groupKey === 'function' && plant) {
      return Stacks.groupKey({
        strain: plant.strain,
        name: plant.name,
        stage: plant.stage,
      });
    }
    return plant && plant.id ? String(plant.id) : '';
  }

  function lastCareYmd(plantId, entries, type) {
    var latest = '';
    (entries || []).forEach(function (e) {
      if (!e || String(e.plantId) !== String(plantId) || e.type !== type) return;
      var d = String(e.date || '').slice(0, 10);
      if (d && d > latest) latest = d;
    });
    return latest || null;
  }

  function wateringInterval(plantId, entries) {
    var n = 2;
    if (window.CoachCore && typeof CoachCore.typicalWateringIntervalDays === 'function') {
      var got = CoachCore.typicalWateringIntervalDays(plantId, entries);
      if (got != null && got > 0) n = got;
    }
    return n;
  }

  function weatherByDate() {
    var map = Object.create(null);
    var cache =
      window.CoachCore && typeof CoachCore.readWeatherCache === 'function'
        ? CoachCore.readWeatherCache()
        : null;
    var days = (cache && cache.days) || [];
    days.forEach(function (d) {
      if (!d || !d.date) return;
      var key = String(d.date).slice(0, 10);
      var max = Number(d.maxtemp != null ? d.maxtemp : d.avgtemp);
      var rain = Number(d.rainChance);
      map[key] = {
        temp: Number.isFinite(max) ? Math.round(max) : null,
        rain: Number.isFinite(rain) ? rain : null,
        heat: Number.isFinite(max) && max >= 28,
        wet: Number.isFinite(rain) && rain >= 50,
        label: d.condition || d.label || '',
      };
    });
    return map;
  }

  function buildMarks(entries, plants, filterIds) {
    var allow = null;
    if (filterIds && filterIds.length) {
      allow = Object.create(null);
      filterIds.forEach(function (id) {
        allow[String(id)] = true;
      });
    }
    var plantById = Object.create(null);
    (plants || []).forEach(function (p) {
      if (p && p.id) plantById[String(p.id)] = p;
    });

    var byDay = Object.create(null);
    function day(ymd) {
      if (!byDay[ymd]) {
        byDay[ymd] = {
          logs: false,
          water: false,
          feed: false,
          stacks: Object.create(null),
          dueWater: false,
          dueFeed: false,
        };
      }
      return byDay[ymd];
    }

    (entries || []).forEach(function (e) {
      if (!e) return;
      var pid = String(e.plantId || '');
      if (allow && !allow[pid]) return;
      var d = String(e.date || '').slice(0, 10);
      if (!d) return;
      var cell = day(d);
      cell.logs = true;
      if (e.type === 'zalijevanje') cell.water = true;
      if (e.type === 'gnojidba') cell.feed = true;
      var sk = stackKeyForPlant(plantById[pid]) || pid;
      cell.stacks[sk] = true;
    });

    var today = todayYmd();
    var list = (plants || []).filter(function (p) {
      return p && p.id && (!allow || allow[String(p.id)]);
    });

    list.forEach(function (p) {
      var pid = String(p.id);
      var lastW = lastCareYmd(pid, entries, 'zalijevanje');
      var interval = wateringInterval(pid, entries);
      var nextW = lastW ? addDaysYmd(lastW, interval) : today;
      if (nextW) {
        if (nextW <= today) day(today).dueWater = true;
        else day(nextW).dueWater = true;
      }

      if (p.stage === 'klijanje') return;
      var lastF = lastCareYmd(pid, entries, 'gnojidba');
      var nextF = lastF ? addDaysYmd(lastF, 5) : today;
      if (nextF) {
        if (nextF <= today) day(today).dueFeed = true;
        else day(nextF).dueFeed = true;
      }
    });

    Object.keys(byDay).forEach(function (k) {
      var cell = byDay[k];
      cell.stackCount = Object.keys(cell.stacks || {}).length;
      if (cell.water) cell.dueWater = false;
      if (cell.feed) cell.dueFeed = false;
    });

    return byDay;
  }

  function monthCells(y, m) {
    var first = new Date(y, m, 1);
    var startPad = (first.getDay() + 6) % 7; // Monday = 0
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var cells = [];
    var i;
    for (i = 0; i < startPad; i += 1) cells.push(null);
    for (i = 1; i <= daysInMonth; i += 1) {
      cells.push(ymdFromParts(y, m, i));
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  function formatLong(ymd) {
    var p = parseYmd(ymd);
    if (!p) return ymd;
    try {
      return new Intl.DateTimeFormat(intlTag(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(Date.UTC(p.y, p.m, p.d)));
    } catch (e) {
      return p.d + ' ' + monthName(p.m, 'short') + ' ' + p.y;
    }
  }

  function render(host, opts) {
    if (!host) return;
    var o = opts || {};
    var c = ensureCursor();
    var today = todayYmd();
    if (!selectedYmd) selectedYmd = today;
    var marks = buildMarks(o.entries, o.plants, o.filterIds);
    var wx = weatherByDate();
    var cells = monthCells(c.y, c.m);
    var title = monthName(c.m) + ' ' + c.y;

    host.innerHTML =
      '<div class="journal-cal">' +
      '<div class="journal-cal-nav">' +
      '<button type="button" class="journal-cal-nav-btn" data-cal-nav="-1" aria-label="Previous month">‹</button>' +
      '<strong class="journal-cal-title">' +
      escapeHtml(title) +
      '</strong>' +
      '<button type="button" class="journal-cal-nav-btn" data-cal-nav="1" aria-label="Next month">›</button>' +
      '<button type="button" class="btn btn-ghost btn-sm journal-cal-today" data-cal-today>' +
      escapeHtml(T('app.calendar.today', 'Today')) +
      '</button>' +
      '</div>' +
      '<div class="journal-cal-weekdays" aria-hidden="true">' +
      weekdayNames().map(function (w) {
        return '<span>' + w + '</span>';
      }).join('') +
      '</div>' +
      '<div class="journal-cal-grid" role="grid" aria-label="Journal calendar">' +
      cells
        .map(function (ymd) {
          if (!ymd) return '<div class="journal-cal-pad"></div>';
          var cell = marks[ymd] || {};
          var weather = wx[ymd] || {};
          var cls = ['journal-cal-day'];
          if (ymd === today) cls.push('is-today');
          if (ymd === selectedYmd) cls.push('is-selected');
          if (cell.logs) cls.push('has-log');
          if (cell.dueWater) cls.push('due-water');
          if (cell.dueFeed) cls.push('due-feed');
          if (weather.heat) cls.push('is-heat');
          if (weather.wet) cls.push('is-rain');
          var num = parseYmd(ymd).d;
          var wxLabel =
            weather.temp != null
              ? '<span class="journal-cal-wx">' + weather.temp + '°</span>'
              : '';
          var dots = '';
          if (cell.logs) {
            dots +=
              '<i class="journal-cal-dot journal-cal-dot--log" title="' +
              escapeHtml(T('app.calendar.logged', 'Logged')) +
              '"></i>';
          }
          if (cell.dueWater) {
            dots +=
              '<i class="journal-cal-dot journal-cal-dot--water" title="' +
              escapeHtml(T('app.calendar.waterDue', 'Water due')) +
              '"></i>';
          }
          if (cell.dueFeed) {
            dots +=
              '<i class="journal-cal-dot journal-cal-dot--feed" title="' +
              escapeHtml(T('app.calendar.feedDue', 'Feed due')) +
              '"></i>';
          }
          var label = T('app.calendar.openDay', 'Open {date}', { date: formatLong(ymd) });
          if (cell.dueWater) label += ', ' + T('app.calendar.wateringDue', 'watering due');
          if (cell.dueFeed) label += ', ' + T('app.calendar.feedingDue', 'feeding due');
          if (cell.logs) label += ', ' + T('app.calendar.hasLogs', 'has logs');
          return (
            '<button type="button" class="' +
            cls.join(' ') +
            '" data-cal-day="' +
            ymd +
            '" aria-label="' +
            escapeHtml(label) +
            '" aria-pressed="' +
            (ymd === selectedYmd ? 'true' : 'false') +
            '">' +
            '<span class="journal-cal-num">' +
            num +
            '</span>' +
            wxLabel +
            '<span class="journal-cal-marks">' +
            dots +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<p class="journal-cal-legend">' +
      '<span><i class="journal-cal-dot journal-cal-dot--log"></i> ' +
      escapeHtml(T('app.calendar.logged', 'Logged')) +
      '</span>' +
      '<span><i class="journal-cal-dot journal-cal-dot--water"></i> ' +
      escapeHtml(T('app.calendar.waterDue', 'Water due')) +
      '</span>' +
      '<span><i class="journal-cal-dot journal-cal-dot--feed"></i> ' +
      escapeHtml(T('app.calendar.feedDue', 'Feed due')) +
      '</span>' +
      '<span class="journal-cal-legend-wx">' +
      escapeHtml(T('app.calendar.fromForecast', '° from your forecast')) +
      '</span>' +
      '</p>' +
      '<div class="journal-cal-panel">' +
      '<div class="journal-cal-panel-head">' +
      '<strong>' +
      escapeHtml(formatLong(selectedYmd)) +
      '</strong>' +
      '<button type="button" class="btn btn-primary btn-tap" data-cal-log>' +
      escapeHtml(T('app.calendar.logThisDay', 'Log this day')) +
      '</button>' +
      '</div>' +
      '<p class="journal-cal-panel-hint" id="journal-cal-panel-hint"></p>' +
      '</div>' +
      '</div>';

    var hint = host.querySelector('#journal-cal-panel-hint');
    if (hint) {
      var sel = marks[selectedYmd] || {};
      var bits = [];
      if (sel.logs) {
        bits.push(
          T('app.calendar.stacksLogged', '{count} stacks logged', {
            count: sel.stackCount || 1,
          })
        );
      } else {
        bits.push(T('app.calendar.noLogs', 'No logs yet'));
      }
      if (sel.dueWater) bits.push(T('app.calendar.wateringDue', 'watering due'));
      if (sel.dueFeed) bits.push(T('app.calendar.feedingDue', 'feeding due'));
      var wsel = wx[selectedYmd];
      if (wsel && wsel.temp != null) {
        bits.push(wsel.temp + '°' + (wsel.heat ? ' heat' : '') + (wsel.wet ? ' rain' : ''));
      }
      hint.textContent = bits.join(' · ');
    }

    host.querySelectorAll('[data-cal-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var delta = Number(btn.getAttribute('data-cal-nav') || 0);
        var next = new Date(c.y, c.m + delta, 1);
        cursor = { y: next.getFullYear(), m: next.getMonth() };
        if (typeof o.onChange === 'function') o.onChange();
      });
    });
    var todayBtn = host.querySelector('[data-cal-today]');
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        var n = new Date();
        cursor = { y: n.getFullYear(), m: n.getMonth() };
        selectedYmd = today;
        if (typeof o.onSelectDay === 'function') o.onSelectDay(selectedYmd, { log: false });
        else if (typeof o.onChange === 'function') o.onChange();
      });
    }
    host.querySelectorAll('[data-cal-day]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ymd = btn.getAttribute('data-cal-day');
        if (!ymd) return;
        var again = ymd === selectedYmd;
        selectedYmd = ymd;
        if (typeof o.onSelectDay === 'function') {
          o.onSelectDay(ymd, { log: again });
        }
      });
    });
    var logBtn = host.querySelector('[data-cal-log]');
    if (logBtn) {
      logBtn.addEventListener('click', function () {
        if (typeof o.onSelectDay === 'function') {
          o.onSelectDay(selectedYmd, { log: true });
        }
      });
    }
  }

  function selectedDate() {
    return selectedYmd || todayYmd();
  }

  function setSelectedDate(ymd) {
    var p = parseYmd(ymd);
    if (!p) return selectedDate();
    selectedYmd = ymdFromParts(p.y, p.m, p.d);
    cursor = { y: p.y, m: p.m };
    return selectedYmd;
  }

  window.GrowtooCalendar = {
    getView: getView,
    setView: setView,
    render: render,
    selectedDate: selectedDate,
    setSelectedDate: setSelectedDate,
    todayYmd: todayYmd,
    formatLong: formatLong,
  };
})();
