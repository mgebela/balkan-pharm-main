/**
 * growtoo Signup model — shared Grower/Adopter registration payload + Firestore profile shape.
 * Auth stays on Firebase; this module owns validation, pending stash, and user profile docs.
 */
(function (root) {
  'use strict';

  var STORAGE_PENDING = 'dnevnik-live-pending-profile-type';
  var STORAGE_AUTH = 'dnevnik-live-auth';

  var PROFILE_TYPES = { grower: 'grower', adopter: 'adopter' };
  var GROW_SETUPS = { indoor: 1, outdoor: 1, mixed: 1 };
  var ADOPTER_INTENTS = {
    support_growers: 1,
    collect_garden: 1,
    earn_rewards: 1,
  };

  function normalizeProfileType(type) {
    var t = String(type == null ? '' : type)
      .trim()
      .toLowerCase();
    if (t === 'adopter' || t === 'adoption' || t === 'adopt') return PROFILE_TYPES.adopter;
    if (t === 'grower' || t === 'grow') return PROFILE_TYPES.grower;
    return '';
  }

  function normalizeGrowSetup(value) {
    var v = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    return GROW_SETUPS[v] ? v : '';
  }

  function normalizeAdopterIntent(value) {
    var v = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    return ADOPTER_INTENTS[v] ? v : '';
  }

  function trimStr(value, max) {
    var s = String(value == null ? '' : value).trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  /**
   * @typedef {Object} SignupPayload
   * @property {'grower'|'adopter'} profileType
   * @property {string} displayName
   * @property {boolean} acceptedTerms
   * @property {string} [growSetup]
   * @property {string} [homeCity]
   * @property {string} [growStyleNote]
   * @property {string} [adopterIntent]
   * @property {boolean} [acceptedDevnet]
   * @property {string} [authProvider] email | google
   */

  /**
   * Validate signup fields for the selected role.
   * @returns {{ ok: boolean, error?: string, payload?: SignupPayload }}
   */
  function validateSignup(input) {
    var raw = input || {};
    var profileType = normalizeProfileType(raw.profileType);
    if (!profileType) {
      return { ok: false, error: 'Choose Grower or Adopter to continue.' };
    }

    var displayName = trimStr(raw.displayName, 64);
    if (!displayName) {
      return { ok: false, error: 'Enter a display name.' };
    }

    if (!raw.acceptedConsent && !(raw.acceptedAge && raw.acceptedTerms)) {
      return {
        ok: false,
        error: 'Confirm you are 18+ and agree to the Terms & Privacy Policy.',
      };
    }

    /** @type {SignupPayload} */
    var payload = {
      profileType: profileType,
      displayName: displayName,
      acceptedTerms: true,
      acceptedAge: true,
      authProvider: raw.authProvider === 'google' ? 'google' : 'email',
    };

    if (profileType === PROFILE_TYPES.grower) {
      var setup = normalizeGrowSetup(raw.growSetup);
      if (!setup) return { ok: false, error: 'Choose a grow setup (indoor, outdoor, or mixed).' };
      var city = trimStr(raw.homeCity, 80);
      payload.growSetup = setup;
      if (city) payload.homeCity = city;
      var note = trimStr(raw.growStyleNote, 240);
      if (note) payload.growStyleNote = note;
      var photo = trimStr(raw.profilePhoto, 220000);
      if (photo && photo.indexOf('data:image/') === 0) {
        payload.profilePhoto = photo;
      } else if (photo && /^https?:\/\//i.test(photo)) {
        payload.profilePhoto = photo.slice(0, 500);
      }
    } else {
      var intent = normalizeAdopterIntent(raw.adopterIntent);
      if (!intent) return { ok: false, error: 'Choose why you’re joining as an adopter.' };
      if (!raw.acceptedDevnet) {
        return { ok: false, error: 'Confirm you understand this uses Solana’s test network (no real value).' };
      }
      payload.adopterIntent = intent;
      payload.acceptedDevnet = true;
    }

    return { ok: true, payload: payload };
  }

  function savePending(payload) {
    try {
      localStorage.setItem(STORAGE_PENDING, JSON.stringify(payload || {}));
    } catch (err) {
      console.warn('signup savePending', err);
    }
  }

  function readPending() {
    try {
      var raw = localStorage.getItem(STORAGE_PENDING) || '';
      if (!raw) return {};
      if (raw === 'grower' || raw === 'adopter') return { profileType: raw };
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
      try {
        var legacy = localStorage.getItem(STORAGE_PENDING) || '';
        if (legacy === 'grower' || legacy === 'adopter') return { profileType: legacy };
      } catch (e2) {
        // ignore
      }
    }
    return {};
  }

  function clearPending() {
    try {
      localStorage.removeItem(STORAGE_PENDING);
    } catch (err) {
      // ignore
    }
  }

  function applyLocalDefaults(payload) {
    if (!payload || typeof payload !== 'object') return;
    var profileType = normalizeProfileType(payload.profileType);
    try {
      if (payload.displayName) {
        localStorage.setItem('dnevnik-live-display-name', trimStr(payload.displayName, 64));
      }
      if (profileType === PROFILE_TYPES.grower) {
        if (payload.homeCity) {
          localStorage.setItem('dnevnik-live-weather-city', trimStr(payload.homeCity, 80));
        }
        var setup = normalizeGrowSetup(payload.growSetup);
        if (setup) localStorage.setItem('dnevnik-live-grow-setup', setup);
        if (payload.growStyleNote) {
          localStorage.setItem('dnevnik-live-grow-style-note', trimStr(payload.growStyleNote, 240));
        }
        if (payload.profilePhoto) {
          localStorage.setItem('dnevnik-live-profile-photo', String(payload.profilePhoto));
        }
      }
      if (profileType === PROFILE_TYPES.adopter) {
        var intent = normalizeAdopterIntent(payload.adopterIntent);
        if (intent) localStorage.setItem('dnevnik-live-adopter-intent', intent);
      }
    } catch (err) {
      // ignore
    }
  }

  function hydrateLocalFromUserDoc(data) {
    if (!data || typeof data !== 'object') return;
    try {
      if (data.displayName && !localStorage.getItem('dnevnik-live-display-name')) {
        localStorage.setItem('dnevnik-live-display-name', trimStr(data.displayName, 64));
      }
      if (data.homeCity && !localStorage.getItem('dnevnik-live-weather-city')) {
        localStorage.setItem('dnevnik-live-weather-city', trimStr(data.homeCity, 80));
      }
      if (data.growSetup && !localStorage.getItem('dnevnik-live-grow-setup')) {
        var setup = normalizeGrowSetup(data.growSetup);
        if (setup) localStorage.setItem('dnevnik-live-grow-setup', setup);
      }
      if (data.growStyleNote && !localStorage.getItem('dnevnik-live-grow-style-note')) {
        localStorage.setItem('dnevnik-live-grow-style-note', trimStr(data.growStyleNote, 240));
      }
      if (data.adopterIntent && !localStorage.getItem('dnevnik-live-adopter-intent')) {
        var intent = normalizeAdopterIntent(data.adopterIntent);
        if (intent) localStorage.setItem('dnevnik-live-adopter-intent', intent);
      }
      if (data.journalSkill && typeof data.journalSkill === 'object') {
        try {
          localStorage.setItem('dnevnik-live-journal-skill', JSON.stringify(data.journalSkill));
        } catch (skillErr) {
          // ignore
        }
      }
      if (data.profilePhoto) {
        try {
          localStorage.setItem('dnevnik-live-profile-photo', String(data.profilePhoto));
        } catch (photoErr) {
          // ignore
        }
      }
    } catch (err) {
      // ignore
    }
  }

  /**
   * Merge signup fields onto a user profile object (create or patch).
   */
  function applyPayloadToUserDoc(target, payload, profileType, opts) {
    var o = opts || {};
    var existing = o.existing || {};
    var onlyIfMissing = !!o.onlyIfMissing;
    if (!payload || typeof payload !== 'object') return target;

    function setField(key, value) {
      if (value == null || value === '') return;
      if (onlyIfMissing && existing[key] != null && existing[key] !== '') return;
      target[key] = value;
    }

    setField('displayName', trimStr(payload.displayName, 64));
    if (payload.authProvider) setField('authProvider', payload.authProvider === 'google' ? 'google' : 'email');
    if (payload.acceptedTerms) setField('acceptedTerms', true);
    if (payload.acceptedAge) setField('acceptedAge', true);

    if (profileType === PROFILE_TYPES.grower) {
      var setup = normalizeGrowSetup(payload.growSetup);
      if (setup) setField('growSetup', setup);
      setField('homeCity', trimStr(payload.homeCity, 80));
      setField('growStyleNote', trimStr(payload.growStyleNote, 240));
      if (payload.profilePhoto) {
        var photo = String(payload.profilePhoto);
        if (photo.indexOf('data:image/') === 0 && photo.length <= 220000) {
          setField('profilePhoto', photo);
        } else if (/^https?:\/\//i.test(photo)) {
          setField('profilePhoto', photo.slice(0, 500));
        }
      }
    }
    if (profileType === PROFILE_TYPES.adopter) {
      var intent = normalizeAdopterIntent(payload.adopterIntent);
      if (intent) setField('adopterIntent', intent);
      if (payload.acceptedDevnet) setField('acceptedDevnet', true);
    }
    return target;
  }

  /**
   * Build the Firestore users/{uid} document for a new account.
   */
  function buildUserProfileDoc(user, payload) {
    var pending = payload && payload.profileType ? payload : readPending();
    var profileType =
      normalizeProfileType(pending.profileType) || PROFILE_TYPES.grower;
    var now = new Date().toISOString();
    var doc = {
      email: (user && user.email) || '',
      uId: (user && user.uid) || '',
      role: 'user',
      profileType: profileType,
      createdAt: now,
      lastLoginAt: now,
      signupAt: now,
      signupSource: 'website',
    };
    if (user && user.displayName && !pending.displayName) {
      pending = Object.assign({}, pending, { displayName: user.displayName });
    }
    applyPayloadToUserDoc(doc, pending, profileType);
    return doc;
  }

  function rememberAuthSession(user) {
    try {
      localStorage.setItem(
        STORAGE_AUTH,
        JSON.stringify({
          email: (user && user.email) || '',
          uid: (user && user.uid) || '',
          loggedAt: Date.now(),
        })
      );
    } catch (err) {
      // ignore
    }
  }

  /**
   * After Firebase Auth succeeds, create/update Firestore profile from pending signup.
   * Works with Firebase compat (app) or modular Firestore instance.
   */
  async function ensureFirestoreProfile(user, firestoreApi) {
    if (!user || !user.uid || !firestoreApi) {
      throw new Error('Missing user or Firestore for signup profile.');
    }
    var pending = readPending();
    var userRef = firestoreApi.collection('users').doc(user.uid);
    var snap = await userRef.get();
    if (!snap.exists) {
      var doc = buildUserProfileDoc(user, pending);
      await userRef.set(doc);
      applyLocalDefaults(pending);
      hydrateLocalFromUserDoc(doc);
      clearPending();
      return { created: true, profile: doc };
    }
    var data = snap.data() || {};
    var patch = { lastLoginAt: new Date().toISOString() };
    var existingType = normalizeProfileType(data.profileType);
    if (!existingType) {
      patch.profileType = normalizeProfileType(pending.profileType) || PROFILE_TYPES.grower;
      applyPayloadToUserDoc(patch, pending, patch.profileType);
      applyLocalDefaults(pending);
    } else if (pending && pending.profileType) {
      applyPayloadToUserDoc(patch, pending, existingType, {
        onlyIfMissing: true,
        existing: data,
      });
      applyLocalDefaults(pending);
    }
    await userRef.update(patch);
    clearPending();
    hydrateLocalFromUserDoc(Object.assign({}, data, patch));
    return { created: false, profile: Object.assign({}, data, patch) };
  }

  var api = {
    STORAGE_PENDING: STORAGE_PENDING,
    PROFILE_TYPES: PROFILE_TYPES,
    normalizeProfileType: normalizeProfileType,
    normalizeGrowSetup: normalizeGrowSetup,
    normalizeAdopterIntent: normalizeAdopterIntent,
    validateSignup: validateSignup,
    savePending: savePending,
    readPending: readPending,
    clearPending: clearPending,
    applyLocalDefaults: applyLocalDefaults,
    hydrateLocalFromUserDoc: hydrateLocalFromUserDoc,
    applyPayloadToUserDoc: applyPayloadToUserDoc,
    buildUserProfileDoc: buildUserProfileDoc,
    rememberAuthSession: rememberAuthSession,
    ensureFirestoreProfile: ensureFirestoreProfile,
  };

  root.GrowtooSignup = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
