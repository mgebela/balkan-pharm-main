/**
 * Journaling skill ladder for traffic growers (and coach context mapping).
 * Levels 1–5 align with GrowerQuests XP titles.
 */

export const JOURNAL_SKILL_TITLES = {
  1: 'New journaler',
  2: 'Active journaler',
  3: 'Dedicated journaler',
  4: 'Seasoned journaler',
  5: 'Master journaler',
};

/** XP thresholds mirroring grower-quests levelFromXp. */
export const JOURNAL_SKILL_XP = {
  1: 0,
  2: 60,
  3: 150,
  4: 300,
  5: 500,
};

export function skillTitle(level) {
  const n = Math.max(1, Math.min(5, Number(level) || 1));
  return JOURNAL_SKILL_TITLES[n];
}

export function levelFromJournalXp(total) {
  const t = Number(total || 0);
  if (t >= 500) return 5;
  if (t >= 300) return 4;
  if (t >= 150) return 3;
  if (t >= 60) return 2;
  return 1;
}

export function xpForLevel(level) {
  const n = Math.max(1, Math.min(5, Number(level) || 1));
  return JOURNAL_SKILL_XP[n];
}

/**
 * Enrich a base honest persona note with skill-appropriate detail.
 * Higher skill = measurements, hypotheses, next actions — still in the grower's voice.
 */
export function enrichNoteForSkill(baseNote, skillLevel, type, salt) {
  const level = Math.max(1, Math.min(5, Number(skillLevel) || 1));
  const base = String(baseNote || '').trim() || (type === 'gnojidba' ? 'Fed.' : 'Watered.');
  const s = Math.abs(Number(salt) || 0);

  if (level <= 1) {
    // Early journaler: short, sometimes incomplete
    const shorts = [
      type === 'gnojidba' ? 'Fed today.' : 'Watered.',
      type === 'gnojidba' ? 'Nutrients in.' : 'Gave water.',
      base.split(/[.!—]/)[0] + '.',
    ];
    return shorts[s % shorts.length];
  }

  if (level === 2) {
    return base;
  }

  if (level === 3) {
    const extras = [
      ' Logged amount roughly.',
      ' Noted runoff colour.',
      ' Checked lower canopy.',
      ' Marked date for next pass.',
    ];
    return base + extras[s % extras.length];
  }

  if (level === 4) {
    const metrics =
      type === 'gnojidba'
        ? [
            ` EC target ~${1.2 + (s % 5) * 0.1} — watching leaf tips.`,
            ` Half-strength; runoff smelled clean.`,
            ` Held cal-mag steady; no tip burn.`,
          ]
        : [
            ` ~${400 + (s % 8) * 50} ml; media felt ${s % 2 ? 'just dry' : 'still cool'}.`,
            ` RH felt high; shortened soak.`,
            ` Probe wetter on shady side — evened it out.`,
          ];
    return base + metrics[s % metrics.length];
  }

  // level 5 — master: diagnosis + next step
  const plans =
    type === 'gnojidba'
      ? [
          ` Hypothesis: mild N lag on edge plants — next feed +10% only there. Will photo if tips stay pale.`,
          ` Plan: plain water next, then resume feed. Logging so adopters see the pause is intentional.`,
          ` Cross-check with stage days; not chasing bloom boost early.`,
        ]
      : [
          ` Hypothesis: uneven dry-back — will rotate pots / check drip tomorrow. No panic yellow yet.`,
          ` Next: log temp/RH after lights-on; if RH >65% overnight, bump exhaust before feed.`,
          ` Linking this to last stage change so the coach/adopters see continuity.`,
        ];
  return base + plans[s % plans.length];
}

/** Coach adaptation hints by journal skill (growers). */
export function coachHintsForGrowerSkill(level) {
  const n = Math.max(1, Math.min(5, Number(level) || 1));
  const map = {
    1: {
      teach: ['how to write a useful daily note', 'what to log after watering (amount, runoff)', 'stage names'],
      avoid: ['advanced EC/pH lectures', 'tokenisation deep-dives unless asked'],
      tone: 'patient, celebrate small consistent logs',
    },
    2: {
      teach: ['add one measurement per care log', 'link notes to a named plant', 'spot overwatering signs'],
      avoid: ['assuming they already track VPD'],
      tone: 'encouraging, push for slightly richer notes',
    },
    3: {
      teach: ['environment readings (temp/RH)', 'feeding schedule discipline', 'quest checklist for growth mints'],
      avoid: ['repeating beginner how-to-water'],
      tone: 'peer coach — concise, actionable',
    },
    4: {
      teach: ['interpret readings vs stage', 'prep harvest care months', 'photo diagnosis habits'],
      avoid: ['generic blog tips'],
      tone: 'expert peer; ground every tip in their snapshot numbers',
    },
    5: {
      teach: ['fine-tune from anomalies', 'mentor-style options (A/B)', 'token/market timing if relevant'],
      avoid: ['hand-holding on basics'],
      tone: 'brief expert; challenge weak hypotheses',
    },
  };
  return map[n];
}

/** Coach adaptation for adopters by portfolio / care needs. */
export function coachHintsForAdopter(needs) {
  const n = needs || {};
  const teach = [];
  if (n.adoptedCount === 0) {
    teach.push('how adopt-stake works', 'what care unlock months mean', 'how to read grower logs');
  } else {
    teach.push('read live stage and care counters on adopted plants');
    if (n.lowCareCount > 0) {
      teach.push('why low care days matter for harvest unlock', 'what good grower logs look like');
    }
    if (n.harvestReadyCount > 0) {
      teach.push('harvest claim readiness and what still blocks unlock');
    }
  }
  return {
    teach,
    avoid: ['proposing create_plant / mint actions', 'pretending the adopter can edit the grower journal'],
    tone: n.adoptedCount === 0 ? 'onboarding investor' : 'portfolio advisor — clear, non-hype',
  };
}
