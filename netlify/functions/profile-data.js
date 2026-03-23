const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'diary-profiles';
const PROFILE_KEY_PREFIX = 'profile:';
const DEFAULT_PROFILE = {
  plants: [],
  entries: [],
  toolbox: {
    watering: [],
    feeding: [],
    environment: [],
    transplant: [],
    stressors: [],
  },
  progress: null,
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function normalizeToolbox(toolbox) {
  const next = toolbox && typeof toolbox === 'object' ? toolbox : {};
  return {
    watering: Array.isArray(next.watering) ? next.watering : [],
    feeding: Array.isArray(next.feeding) ? next.feeding : [],
    environment: Array.isArray(next.environment) ? next.environment : [],
    transplant: Array.isArray(next.transplant) ? next.transplant : [],
    stressors: Array.isArray(next.stressors) ? next.stressors : [],
  };
}

function normalizeProfile(profile) {
  const next = profile && typeof profile === 'object' ? profile : {};
  const plants = Array.isArray(next.plants) ? next.plants : [];
  const entries = Array.isArray(next.entries) ? next.entries : [];
  return {
    ...DEFAULT_PROFILE,
    plants,
    entries,
    toolbox: normalizeToolbox(next.toolbox),
    progress:
      next.progress && typeof next.progress === 'object'
        ? next.progress
        : {
            plantsCount: plants.length,
            entriesCount: entries.length,
            updatedAt: new Date().toISOString(),
          },
  };
}

function getProfileKey(event) {
  const user = event?.clientContext?.user;
  if (!user) return null;
  const identityKey = user.sub || user.email;
  if (!identityKey) return null;
  return PROFILE_KEY_PREFIX + String(identityKey);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        allow: 'GET, PUT, OPTIONS',
      },
    };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'PUT') {
    return json(405, { error: 'Method not allowed' });
  }

  const profileKey = getProfileKey(event);
  if (!profileKey) {
    return json(401, { error: 'Unauthorized' });
  }

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    const profile = await store.get(profileKey, { type: 'json' });
    return json(200, { profile: normalizeProfile(profile) });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (!payload || typeof payload !== 'object') {
    return json(400, { error: 'Invalid payload' });
  }

  const profile = normalizeProfile(payload);
  profile.progress = {
    ...(profile.progress || {}),
    plantsCount: profile.plants.length,
    entriesCount: profile.entries.length,
    updatedAt: new Date().toISOString(),
  };

  await store.setJSON(profileKey, profile);
  return json(200, { profile });
};
