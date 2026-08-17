/*
 * Coach core — graduated permissions, activity receipts, weather+history
 * predictions, and journal narration. Keeps the grow buddy voice calm.
 */
(function () {
  'use strict';

  var STORAGE_PERMS = 'growtoo-coach-permissions';
  var STORAGE_LOG = 'growtoo-coach-activity';
  var STORAGE_NOTES = 'growtoo-coach-entry-notes';
  var WEATHER_CACHE = 'dnevnik-live-weather-cache';
  var WEATHER_CITY = 'dnevnik-live-weather-city';

  /** Action classes — never collapse high-stakes into full auto. */
  var ACTION_CLASS = {
    add_entry: 'draft',
    create_plant: 'draft',
    set_stage: 'draft',
    schedule_reminder: 'automatic',
    dismiss_reminder: 'automatic',
    import_seed: 'high_stakes',
    mint_growth: 'high_stakes',
    link_plant: 'high_stakes',
    market_list: 'high_stakes',
    delete_entry: 'advisory',
    diagnosis: 'advisory',
  };

  var DEFAULT_PERMS = {
    /** always true in practice — reminders/nudges have no off switch in UI */
    routineNudges: true,
    /** draft journal entries for one-tap confirm */
    draftEntries: true,
    /** draft stage transition suggestions for one-tap confirm */
    suggestStages: true,
    /** never true for mint/list/delete — hard lock */
    allowAutoMint: false,
  };

  /* [dictionary key, English] — resolved in stageLabel(), because this
     table is built while the page parses, before the dictionary loads. */
  var STAGE_LABELS = {
    klijanje: ['app.stage.germination', 'Germination'],
    sadnica: ['app.stage.seedling', 'Seedling'],
    vegetativna: ['app.stage.vegetative', 'Vegetative'],
    cvjetanje: ['app.stage.flowering', 'Flowering'],
    susenje: ['app.stage.dryingShort', 'Drying'],
  };

  /** Rough stage-duration norms (days) for common auto/CBD grows — advisory only. */
  var STAGE_NORM_DAYS = {
    klijanje: { typical: 5, flagAfter: 10 },
    sadnica: { typical: 14, flagAfter: 21 },
    vegetativna: { typical: 28, flagAfter: 45 },
    cvjetanje: { typical: 56, flagAfter: 70 },
    susenje: { typical: 14, flagAfter: 28 },
  };

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // ignore
    }
  }

  function getPermissions() {
    var saved = readJson(STORAGE_PERMS, null);
    var next = Object.assign({}, DEFAULT_PERMS, saved && typeof saved === 'object' ? saved : {});
    next.routineNudges = true;
    next.allowAutoMint = false;
    return next;
  }

  function setPermissions(patch) {
    var next = Object.assign({}, getPermissions(), patch || {});
    next.routineNudges = true; // hard lock — always on
    next.allowAutoMint = false; // hard lock
    // Only allow the two draft toggles to change
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'draftEntries')) {
      next.draftEntries = !!patch.draftEntries;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'suggestStages')) {
      next.suggestStages = !!patch.suggestStages;
    }
    writeJson(STORAGE_PERMS, next);
    return next;
  }

  /**
   * How an action should run given current permissions.
   * Returns: 'auto' | 'draft' | 'confirm' | 'advise'
   */
  function resolveActionMode(actionType) {
    var cls = ACTION_CLASS[actionType] || 'draft';
    var perms = getPermissions();
    if (cls === 'advisory') return 'advise';
    if (cls === 'high_stakes') return 'confirm'; // never auto
    if (cls === 'automatic') return 'auto'; // always-on tier
    if (actionType === 'add_entry' || actionType === 'create_plant') {
      return perms.draftEntries ? 'draft' : 'advise';
    }
    if (actionType === 'set_stage') {
      return perms.suggestStages ? 'draft' : 'advise';
    }
    return 'draft';
  }

  function stageLabel(stageKey) {
    var row = STAGE_LABELS[stageKey];
    return row ? T(row[0], row[1]) : stageKey || '';
  }

  function actionClassLabel(actionType) {
    var cls = ACTION_CLASS[actionType] || 'draft';
    if (cls === 'automatic') return T('app.coach.classAlwaysOn', 'Always on');
    if (cls === 'draft') return T('app.coach.classDraft', 'Draft & confirm');
    if (cls === 'high_stakes') return T('app.coach.classApproval', 'Needs your approval');
    return T('app.coach.classAdvisory', 'Advisory only');
  }

  function getActivityLog() {
    var list = readJson(STORAGE_LOG, []);
    return Array.isArray(list) ? list : [];
  }

  function logActivity(entry) {
    var list = getActivityLog();
    var row = Object.assign(
      {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: new Date().toISOString(),
      },
      entry || {}
    );
    list.unshift(row);
    writeJson(STORAGE_LOG, list.slice(0, 80));
    return row;
  }

  function getEntryNotes() {
    var map = readJson(STORAGE_NOTES, {});
    return map && typeof map === 'object' ? map : {};
  }

  function setEntryNote(entryId, note) {
    if (!entryId || !note) return;
    var map = getEntryNotes();
    map[String(entryId)] = {
      note: String(note).slice(0, 280),
      at: new Date().toISOString(),
    };
    writeJson(STORAGE_NOTES, map);
  }

  function getEntryNote(entryId) {
    var map = getEntryNotes();
    var row = map[String(entryId)];
    return row && row.note ? row.note : '';
  }

  function toMs(v) {
    if (!v) return 0;
    var t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }

  function daysBetween(aMs, bMs) {
    if (!aMs || !bMs) return null;
    return Math.round(Math.abs(bMs - aMs) / 86400000);
  }

  function careDatesMs(plantId, entries, types) {
    var allow = types || [];
    var dates = [];
    (entries || []).forEach(function (e) {
      if (!e || String(e.plantId) !== String(plantId)) return;
      if (allow.length && allow.indexOf(e.type) < 0) return;
      var t = toMs(e.date || e.createdAt);
      if (t) dates.push(t);
    });
    dates.sort(function (a, b) {
      return b - a;
    });
    return dates;
  }

  /** Median gap between last up to 6 watering logs (days). */
  function typicalWateringIntervalDays(plantId, entries) {
    var dates = careDatesMs(plantId, entries, ['zalijevanje']);
    if (dates.length < 2) return null;
    var gaps = [];
    for (var i = 0; i < Math.min(dates.length - 1, 5); i += 1) {
      var g = daysBetween(dates[i], dates[i + 1]);
      if (g != null && g > 0 && g < 21) gaps.push(g);
    }
    if (!gaps.length) return null;
    gaps.sort(function (a, b) {
      return a - b;
    });
    return gaps[Math.floor(gaps.length / 2)];
  }

  function readWeatherCache() {
    var cache = readJson(WEATHER_CACHE, null);
    if (!cache || !cache.at || !Array.isArray(cache.days)) return null;
    if (Date.now() - cache.at > 6 * 3600000) return null; // 6h
    return cache;
  }

  function saveWeatherCache(payload) {
    writeJson(WEATHER_CACHE, Object.assign({ at: Date.now() }, payload || {}));
  }

  function getWeatherCity() {
    try {
      return String(localStorage.getItem(WEATHER_CITY) || '').trim();
    } catch (e) {
      return '';
    }
  }

  /** Hottest upcoming day in next 3 days with avgtemp or maxtemp. */
  function upcomingHeat(cache) {
    if (!cache || !cache.days) return null;
    var best = null;
    cache.days.slice(0, 4).forEach(function (d, i) {
      if (!d) return;
      var max = Number(d.maxtemp != null ? d.maxtemp : d.avgtemp);
      if (!Number.isFinite(max)) return;
      if (!best || max > best.temp) {
        best = {
          temp: max,
          label: d.label || d.date || 'soon',
          date: d.date,
          rainChance: d.rainChance != null ? d.rainChance : null,
          offsetDays: i,
        };
      }
    });
    return best && best.temp >= 28 ? best : null;
  }

  /**
   * Up to three grow-relevant notes about the forecast, most urgent first.
   *
   * Reads only the days actually returned by the forecast, so it never implies
   * knowledge of a day it doesn't have. Returns [] when nothing is worth saying
   * — silence is better than filler advice.
   */
  function weatherAdvice(cache) {
    var days = (cache && cache.days) || [];
    if (!days.length) return [];

    var out = [];
    var num = function (v) {
      var n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    var hottest = null;
    var coldest = null;
    var wettest = null;
    var dryRun = true;

    days.forEach(function (d) {
      if (!d) return;
      var max = num(d.maxtemp != null ? d.maxtemp : d.avgtemp);
      var min = num(d.mintemp != null ? d.mintemp : d.avgtemp);
      var rain = num(d.rainChance);
      if (max != null && (!hottest || max > hottest.t)) hottest = { t: max, label: d.label || d.date };
      if (min != null && (!coldest || min < coldest.t)) coldest = { t: min, label: d.label || d.date };
      if (rain != null && (!wettest || rain > wettest.r)) wettest = { r: rain, label: d.label || d.date };
      if (rain == null || rain >= 40) dryRun = false;
    });

    if (hottest && hottest.t >= 30) {
      out.push({
        tone: 'warn',
        text:
          T(
            'app.coach.wxHeatWarning',
            'Heat warning — {temp}° on {day}. Water early morning or after sunset, never in full midday sun.',
            { temp: Math.round(hottest.t), day: hottest.label }
          ),
      });
    } else if (hottest && hottest.t >= 26) {
      out.push({
        tone: 'info',
        text:
          T(
            'app.coach.wxWarmSpell',
            'Warm spell up to {temp}° ({day}). Check soil moisture a finger deep before watering.',
            { temp: Math.round(hottest.t), day: hottest.label }
          ),
      });
    }

    if (wettest && wettest.r >= 60) {
      out.push({
        tone: 'info',
        text:
          T(
            'app.coach.wxRain',
            'Rain likely {day} ({chance}%). Hold off watering and feeding — nutrients wash straight through.',
            { day: wettest.label, chance: Math.round(wettest.r) }
          ),
      });
    } else if (dryRun && days.length > 1) {
      out.push({
        tone: 'info',
        text: T(
          'app.coach.wxNoRain',
          'No real rain in the forecast. Outdoor pots dry out fastest — check them daily.'
        ),
      });
    }

    if (coldest && coldest.t <= 8) {
      out.push({
        tone: 'warn',
        text:
          T(
            'app.coach.wxColdNight',
            'Cold night — down to {temp}° on {day}. Move sensitive pots under cover or indoors.',
            { temp: Math.round(coldest.t), day: coldest.label }
          ),
      });
    }

    if (hottest && coldest && hottest.t - coldest.t >= 18) {
      out.push({
        tone: 'info',
        text:
          T(
            'app.coach.wxSwing',
            'Wide day/night swing ({low}–{high}°). Expect slower growth; avoid heavy feeding until it settles.',
            { low: Math.round(coldest.t), high: Math.round(hottest.t) }
          ),
      });
    }

    return out.slice(0, 3);
  }

  function buildPredictiveNudges(plants, entries) {
    var list = [];
    var weather = readWeatherCache();
    var heat = upcomingHeat(weather);

    (plants || []).forEach(function (plant) {
      if (!plant || !plant.id) return;
      var name = plant.name || T('app.stack.plant', 'Plant');
      var interval = typicalWateringIntervalDays(plant.id, entries);
      var waterDates = careDatesMs(plant.id, entries, ['zalijevanje']);
      var lastWater = waterDates[0] || 0;
      var daysSince = lastWater ? Math.floor((Date.now() - lastWater) / 86400000) : null;

      if (heat && interval != null && daysSince != null) {
        var overPace = daysSince >= Math.max(1, interval);
        var heatSoon = heat.offsetDays <= 2;
        if (overPace && heatSoon) {
          list.push({
            id: 'predict-heat-water:' + plant.id,
            plantId: plant.id,
            severity: 'urgent',
            kind: 'predictive',
            title: T('app.coach.heatPaceTitle', 'Heat + watering pace'),
            message: T(
              'app.coach.heatPaceMessage',
              'Warm spell around {day} (~{temp}°C). {plant} is already {since} since water — your usual gap is about {gap}. Worth watering today.',
              {
                day: heat.label,
                temp: Math.round(heat.temp),
                plant: name,
                since: T('app.coach.days', '{count} days', { count: daysSince }),
                gap: T('app.coach.days', '{count} days', { count: interval }),
              }
            ),
            prompt: T(
              'app.coach.heatPacePrompt',
              'Heat is coming and "{plant}" is past my usual watering pace. Should I water today, and what should I watch for?',
              { plant: name }
            ),
          });
        }
      } else if (heat && daysSince != null && daysSince >= 2 && heat.offsetDays <= 1) {
        list.push({
          id: 'predict-heat-water:' + plant.id,
          plantId: plant.id,
          severity: 'urgent',
          kind: 'predictive',
          title: T('app.coach.heatCheckTitle', 'Heat check'),
          message: T(
            'app.coach.heatCheckMessage',
            '{plant}: ~{temp}°C coming {day}, and watering was {days} ago. Check moisture today.',
            {
              plant: name,
              temp: Math.round(heat.temp),
              day: heat.label,
              days: T('app.coach.days', '{count} days', { count: daysSince }),
            }
          ),
          prompt: T(
            'app.coach.heatCheckPrompt',
            'Help me decide if "{plant}" needs water before the heat.',
            { plant: name }
          ),
        });
      }

      // Stage-duration advisory (never autonomous)
      var stage = plant.stage || '';
      var norm = STAGE_NORM_DAYS[stage];
      if (norm) {
        var stageAt = toMs((plant.stageDates && plant.stageDates[stage]) || plant.startDate);
        if (stageAt) {
          var daysIn = Math.floor((Date.now() - stageAt) / 86400000);
          if (daysIn >= norm.flagAfter) {
            list.push({
              id: 'stage-pace:' + plant.id + ':' + stage,
              plantId: plant.id,
              severity: 'info',
              kind: 'advisory',
              title: T('app.coach.stagePaceTitle', 'Stage pace check'),
              message: T(
                'app.coach.stagePaceMessage',
                '{plant} has been in {stage} for {days}. Many similar grows move on around day {typical} — take a look when you can (your call).',
                {
                  plant: name,
                  stage: stageLabel(stage),
                  days: T('app.coach.days', '{count} days', { count: daysIn }),
                  typical: norm.typical,
                }
              ),
              prompt: T(
                'app.coach.stagePacePrompt',
                'Plant "{plant}" has been in {stage} for {days}. What signs should I check before changing stage?',
                {
                  plant: name,
                  stage: stageLabel(stage),
                  days: T('app.coach.days', '{count} days', { count: daysIn }),
                }
              ),
            });
          }
        }
      }
    });

    return list.slice(0, 6);
  }

  function narrateAfterEntry(entry, plant) {
    if (!entry || !entry.id) return null;
    var type = entry.type || '';
    var name = (plant && plant.name) || T('app.coach.yourPlant', 'your plant');
    var weather = readWeatherCache();
    var heat = upcomingHeat(weather);
    var note = '';

    if (type === 'zalijevanje') {
      var interval = plant ? typicalWateringIntervalDays(plant.id, readJson('dnevnik-live-entries', [])) : null;
      var nextDays = interval != null ? interval : 2;
      if (heat && heat.offsetDays <= 2) {
        note = T(
          'app.coach.noteWaterHeat',
          'Noted — with ~{temp}°C around {day}, check moisture sooner than usual (often within a day).',
          { temp: Math.round(heat.temp), day: heat.label }
        );
      } else {
        note = T(
          'app.coach.noteWaterNext',
          'Noted — next watering often lands around {days} for {plant}, depending on pot size and heat.',
          {
            days: T('app.coach.days', '{count} days', { count: nextDays }),
            plant: name,
          }
        );
      }
    } else if (type === 'gnojidba') {
      note = T(
        'app.coach.noteFeeding',
        'Feeding logged for {plant}. Watch leaf colour over the next few days — yellowing needs a human look, not an auto-fix.',
        { plant: name }
      );
    } else if (type === 'faza' || type === 'podfaza') {
      note = T(
        'app.coach.noteStage',
        'Stage update recorded. Keep logging care so the trail stays clear.'
      );
    } else {
      return null;
    }

    setEntryNote(entry.id, note);
    logActivity({
      kind: 'narration',
      tier: 'automatic',
      title:
        type === 'zalijevanje'
          ? T('app.coach.loggedWatering', 'Logged a watering note')
          : type === 'gnojidba'
            ? T('app.coach.loggedFeeding', 'Logged a feeding note')
            : T('app.coach.loggedJournal', 'Logged a journal note'),
      body: note,
      plantId: plant && plant.id,
      entryId: entry.id,
      status: 'done',
    });
    return note;
  }

  function dashboardBriefing(plants, entries) {
    var list = plants || [];
    var ents = entries || [];
    if (!list.length) {
      return T(
        'app.coach.briefEmpty',
        'Add a plant when you are ready — Coach will help keep the care trail tidy.'
      );
    }
    var nudges = buildPredictiveNudges(list, ents);
    if (nudges.length) {
      return nudges[0].message;
    }
    var waterDates = [];
    list.forEach(function (p) {
      careDatesMs(p.id, ents, ['zalijevanje']).forEach(function (t) {
        waterDates.push(t);
      });
    });
    waterDates.sort(function (a, b) {
      return b - a;
    });
    var daysSince = waterDates[0] ? Math.floor((Date.now() - waterDates[0]) / 86400000) : null;
    var top = list[0];
    var stage = stageLabel(top.stage) || T('app.coach.growing', 'growing');
    if (daysSince == null) {
      return T(
        'app.coach.briefNoWater',
        '{plants} in the journal. Log a watering when you can — Coach uses that pace for weather tips.',
        { plants: T('app.coach.plants', '{count} plants', { count: list.length }) }
      );
    }
    if (daysSince === 0) {
      return T(
        'app.coach.briefSteady',
        'Looking steady — watering logged today. {plant} is in {stage}.',
        { plant: top.name || T('app.coach.leadPlant', 'Lead plant'), stage: stage }
      );
    }
    return T(
      'app.coach.briefLastWater',
      '{plant} · {stage}. Last watering {days} ago across the garden.',
      {
        plant: top.name || T('app.coach.yourGrow', 'Your grow'),
        stage: stage,
        days: T('app.coach.days', '{count} days', { count: daysSince }),
      }
    );
  }

  function specimenNo(index) {
    var n = String((index || 0) + 1);
    while (n.length < 4) n = '0' + n;
    return n;
  }

  /** Short serif line for the Journal "Today" card. */
  function todayHeadline(plants, entries) {
    var list = plants || [];
    var ents = entries || [];
    if (!list.length) {
      return T(
        'app.coach.railEmpty',
        'Add a plant when you are ready — Coach will keep the care trail tidy.'
      );
    }
    var nudges = buildPredictiveNudges(list, ents);
    if (nudges.length) {
      var n = nudges[0];
      var plantIdx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === n.plantId) {
          plantIdx = i;
          break;
        }
      }
      var plant = plantIdx >= 0 ? list[plantIdx] : null;
      var name = (plant && plant.name) || T('app.stack.plant', 'Plant');
      var no = plantIdx >= 0 ? ' №' + specimenNo(plantIdx) : '';
      if (n.id && String(n.id).indexOf('predict-heat-water') === 0) {
        var heat = upcomingHeat(readWeatherCache());
        return heat
          ? T('app.coach.railDueHeat', '{plant} is due for watering — heat wave {day}', {
              plant: name + no,
              day: heat.label,
            })
          : T('app.coach.railDue', '{plant} is due for watering', { plant: name + no });
      }
      if (n.id && String(n.id).indexOf('stage-pace') === 0) {
        return T(
          'app.coach.railStage',
          '{plant} may be ready to move stage — take a look when you can.',
          { plant: name + no }
        );
      }
      return n.message;
    }
    var top = list[0];
    var waterDates = careDatesMs(top.id, ents, ['zalijevanje']);
    var daysSince = waterDates[0] ? Math.floor((Date.now() - waterDates[0]) / 86400000) : null;
    var label = (top.name || T('app.stack.plant', 'Plant')) + ' №' + specimenNo(0);
    if (daysSince == null) {
      return T('app.coach.railFirstWater', '{plant} is waiting for a first watering.', {
        plant: label,
      });
    }
    if (daysSince === 0) {
      return T('app.coach.railSteady', '{plant} looks steady — watering logged today.', {
        plant: label,
      });
    }
    if (daysSince >= 2) {
      return T('app.coach.railOverdue', '{plant} is due for watering — last care {days} ago.', {
        plant: label,
        days: T('app.coach.days', '{count} days', { count: daysSince }),
      });
    }
    return T('app.coach.railYesterday', '{plant} · last watering yesterday.', { plant: label });
  }

  function relativeTime(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    var sec = Math.round((Date.now() - t) / 1000);
    /* Intl.RelativeTimeFormat words this per language — "5 min ago",
       "vor 5 Min.", "prije 5 min" — so there is nothing to translate here
       beyond the "just now" case. */
    var tag = (window.I18N && window.I18N.locale) || 'en';
    function rel(value, unit) {
      try {
        return new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'short' }).format(
          -value,
          unit
        );
      } catch (e) {
        return value + ' ' + unit;
      }
    }
    if (sec < 60) return T('app.coach.justNow', 'just now');
    if (sec < 3600) return rel(Math.floor(sec / 60), 'minute');
    if (sec < 86400) return rel(Math.floor(sec / 3600), 'hour');
    if (sec < 604800) return rel(Math.floor(sec / 86400), 'day');
    try {
      return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }).format(new Date(t));
    } catch (e) {
      return '';
    }
  }

  function iconSvg(name) {
    var common =
      ' viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (name === 'bell') {
      return (
        '<svg' +
        common +
        '><path d="M6 9a6 6 0 0112 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>'
      );
    }
    if (name === 'calendar') {
      return (
        '<svg' +
        common +
        '><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3.5V7M16 3.5V7M3.5 10h17"/></svg>'
      );
    }
    if (name === 'doc') {
      return (
        '<svg' +
        common +
        '><path d="M7 3.5h7l4 4V20a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V5A1.5 1.5 0 017 3.5z"/><path d="M14 3.5V8h4.5"/><path d="M9 13h6M9 17h4"/></svg>'
      );
    }
    if (name === 'sync') {
      return (
        '<svg' +
        common +
        '><path d="M4 12a8 8 0 0113.5-5.8L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.5 5.8L4 16"/><path d="M4 20v-4h4"/></svg>'
      );
    }
    if (name === 'upload') {
      return (
        '<svg' +
        common +
        '><path d="M12 16V5"/><path d="M8 9l4-4 4 4"/><path d="M5 19h14"/></svg>'
      );
    }
    if (name === 'edit') {
      return (
        '<svg' +
        common +
        '><path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8 4 20z"/><path d="M13.5 7.5l3 3"/></svg>'
      );
    }
    if (name === 'lock') {
      return (
        '<svg' +
        common +
        '><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>'
      );
    }
    if (name === 'gear') {
      return (
        '<svg' +
        common +
        '><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"/></svg>'
      );
    }
    if (name === 'check') {
      return (
        '<svg' +
        common +
        '><circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.6 2.6L16.2 9"/></svg>'
      );
    }
    if (name === 'clock') {
      return (
        '<svg' +
        common +
        '><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>'
      );
    }
    return '';
  }

  function settingsRowHtml(opts) {
    var o = opts || {};
    var right = '';
    if (o.kind === 'always') {
      right =
        '<span class="coach-settings-always">' +
        T('app.coach.alwaysOnBadge', 'always on') +
        '</span>';
    } else if (o.kind === 'toggle') {
      right =
        '<label class="coach-toggle">' +
        '<input type="checkbox" data-coach-perm="' +
        esc(o.key) +
        '"' +
        (o.on ? ' checked' : '') +
        ' />' +
        '<span class="coach-toggle-ui" aria-hidden="true"></span>' +
        '<span class="visually-hidden">' +
        esc(o.label) +
        '</span>' +
        '</label>';
    } else if (o.kind === 'lock') {
      right = '<span class="coach-settings-lock" title="Always requires confirmation">' + iconSvg('lock') + '</span>';
    }
    return (
      '<div class="coach-settings-row">' +
      '<span class="coach-settings-icon">' +
      iconSvg(o.icon) +
      '</span>' +
      '<span class="coach-settings-label">' +
      esc(o.label) +
      '</span>' +
      right +
      '</div>'
    );
  }

  function activityLogHtml(limit) {
    var list = getActivityLog().slice(0, limit || 12);
    if (!list.length) {
      return (
        '<p class="coach-activity-empty">' +
        T(
          'app.coach.activityEmpty',
          'No coach actions yet. Reminders, drafts, and confirmations will show up here.'
        ) +
        '</p>'
      );
    }
    return (
      '<ul class="coach-activity-list">' +
      list
        .map(function (row) {
          var pending = String(row.status || '') === 'pending';
          var title = row.title || row.kind || T('app.coach.action', 'Action');
          if (row.body && pending) title = row.body;
          else if (row.body && !pending && row.kind === 'draft') title = row.title || row.body;
          return (
            '<li class="coach-activity-item coach-activity-item--' +
            (pending ? 'pending' : 'done') +
            '">' +
            '<span class="coach-activity-mark" aria-hidden="true">' +
            iconSvg(pending ? 'clock' : 'check') +
            '</span>' +
            '<span class="coach-activity-text">' +
            esc(title) +
            '</span>' +
            '<time class="coach-activity-time">' +
            esc(relativeTime(row.at)) +
            '</time>' +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  /** Combined settings + activity — two halves of the same trust mechanism. */
  function settingsScreenHtml() {
    var p = getPermissions();
    return (
      '<div class="coach-settings" id="coach-settings">' +
      '<header class="coach-settings-head">' +
      '<div class="coach-settings-head-main">' +
      '<span class="coach-settings-gear">' +
      iconSvg('gear') +
      '</span>' +
      '<div>' +
      '<h3 class="coach-settings-title">' +
      T('app.coach.settingsTitle', 'Coach settings') +
      '</h3>' +
      '<p class="coach-settings-sub">' +
      T('app.coach.settingsSub', 'Choose what your coach can do on its own.') +
      '</p>' +
      '</div></div>' +
      '</header>' +
      '<section class="coach-settings-section">' +
      '<h4 class="coach-settings-section-label">' +
      T('app.coach.classAlwaysOn', 'Always on') +
      '</h4>' +
      settingsRowHtml({
        kind: 'always',
        icon: 'bell',
        label: T('app.coach.setReminders', 'Watering & feeding reminders'),
      }) +
      settingsRowHtml({
        kind: 'always',
        icon: 'calendar',
        label: T('app.coach.setWeatherNudges', 'Weather-based care nudges'),
      }) +
      '</section>' +
      '<section class="coach-settings-section">' +
      '<h4 class="coach-settings-section-label">' +
      T('app.coach.classDraft', 'Draft & confirm') +
      '</h4>' +
      '<p class="coach-settings-section-hint">' +
      T('app.coach.draftHint', 'Coach prepares it, you approve with one tap.') +
      '</p>' +
      settingsRowHtml({
        kind: 'toggle',
        icon: 'doc',
        label: T('app.coach.setDraftEntries', 'Draft journal entries'),
        key: 'draftEntries',
        on: !!p.draftEntries,
      }) +
      settingsRowHtml({
        kind: 'toggle',
        icon: 'sync',
        label: T('app.coach.setSuggestStages', 'Suggest stage transitions'),
        key: 'suggestStages',
        on: !!p.suggestStages,
      }) +
      '</section>' +
      '<section class="coach-settings-section">' +
      '<h4 class="coach-settings-section-label">' +
      T('app.coach.classApproval', 'Needs your approval') +
      '</h4>' +
      '<p class="coach-settings-section-hint">' +
      T('app.coach.approvalHint', 'Always requires your confirmation.') +
      '</p>' +
      settingsRowHtml({
        kind: 'lock',
        icon: 'upload',
        label: T('app.coach.setMintList', 'Mint or list on market'),
      }) +
      settingsRowHtml({
        kind: 'lock',
        icon: 'edit',
        label: T('app.coach.setEditDelete', 'Edit or delete entries'),
      }) +
      '</section>' +
      '<section class="coach-settings-section coach-settings-section--activity">' +
      '<h4 class="coach-settings-section-label">' +
      T('app.coach.activityTitle', 'Coach activity') +
      '</h4>' +
      activityLogHtml(12) +
      '</section>' +
      '</div>'
    );
  }

  function permissionsPanelHtml() {
    return settingsScreenHtml();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.CoachCore = {
    ACTION_CLASS: ACTION_CLASS,
    getPermissions: getPermissions,
    setPermissions: setPermissions,
    resolveActionMode: resolveActionMode,
    actionClassLabel: actionClassLabel,
    logActivity: logActivity,
    getActivityLog: getActivityLog,
    setEntryNote: setEntryNote,
    getEntryNote: getEntryNote,
    buildPredictiveNudges: buildPredictiveNudges,
    narrateAfterEntry: narrateAfterEntry,
    dashboardBriefing: dashboardBriefing,
    todayHeadline: todayHeadline,
    permissionsPanelHtml: permissionsPanelHtml,
    settingsScreenHtml: settingsScreenHtml,
    activityLogHtml: activityLogHtml,
    readWeatherCache: readWeatherCache,
    saveWeatherCache: saveWeatherCache,
    weatherAdvice: weatherAdvice,
    getWeatherCity: getWeatherCity,
    typicalWateringIntervalDays: typicalWateringIntervalDays,
  };
})();
