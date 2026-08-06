/**
 * Sample public journal posts for traffic growers (Admin SDK writes private + public).
 */
import { TRAFFIC_BATCH } from './personas.js';

function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** @param {object} grower persona + uid */
export function sampleStoriesForGrower(grower) {
  const photo = (grower.plantPhotoPool && grower.plantPhotoPool[0]) || '';
  const templates = {
    'grower-s': [
      {
        category: 'tip',
        title: 'Radiator dry air in a Zagreb closet',
        body:
          'Short tip: when the radiator runs, the closet RH drops hard. I water lighter and crack the door for ten minutes after lights-on. No fancy gadget — just not flooding dry media.',
      },
      {
        category: 'problem',
        title: 'One yellow lower leaf — I waited',
        body:
          'Honest post: one lower leaf went yellow. I almost fed. Waited two days, checked the media with a finger, watered half. Leaf stayed yellow but no spread. Sometimes doing less is the fix.',
        coverPhoto: photo,
      },
      {
        category: 'look',
        title: 'Evening look — canopy is even enough',
        body:
          'Quick look after work. Tops are level enough for a closet. Smell is clean, not musty. That is the whole update.',
        coverPhoto: photo,
      },
    ],
    'grower-m': [
      {
        category: 'tip',
        title: 'Sea fog vs tent exhaust',
        body:
          'Coastal tip: morning fog pushes RH up fast. I bump exhaust before watering, not after. Wet media + fog = condensation on the walls. Wipe, crack intake, then irrigate.',
      },
      {
        category: 'visit',
        title: 'Visited a Poličnik neighbour’s lean-to',
        body:
          'Walked over to a neighbour’s lean-to. Different problems (wind, not humidity) but same honesty: he logs when he skips a day. Borrowed that habit for the tent book.',
      },
      {
        category: 'product',
        title: 'Small jar of dry trim tea',
        body:
          'Not selling anything — just noting I dried a jar of trim for tea. Labelled the week and the cohort. Product from the plants, logged so I remember which feed week it came from.',
        coverPhoto: photo,
      },
    ],
    'grower-l': [
      {
        category: 'daybook',
        title: 'Osijek wind before irrigation',
        body:
          'Field daybook: wind was up before the irrigation pass. Soil crust on the west edge. We slowed the line and walked the first two rows. Weather first, then water — always.',
        coverPhoto: photo,
      },
      {
        category: 'tip',
        title: 'Do not chase EC after a storm week',
        body:
          'Tip from the fields: after a wet week, do not spike feed to “catch up.” Plants are still drinking rain. We held the mix and watched leaf colour for three days.',
      },
      {
        category: 'look',
        title: 'Row check — flowering blocks look steady',
        body:
          'Looked the flowering blocks this morning. Colour even, no obvious pest pockets. Photo for the record more than for the gram.',
        coverPhoto: photo,
      },
    ],
  };
  return templates[grower.key] || templates['grower-s'];
}

export function buildJournalSeedWrites(db, grower) {
  const writes = [];
  const now = new Date().toISOString();
  const slug = grower.publicSlug || slugify(grower.firstName + '-' + grower.city);
  const displayName = grower.displayName || 'Grower';
  const stories = sampleStoriesForGrower(grower);

  writes.push({
    ref: db.collection('users').doc(grower.uid),
    data: {
      publicProfileEnabled: true,
      publicSlug: slug,
      publicBio: grower.publicBio || grower.notes || '',
      homeCity: grower.city || '',
      growSetup: grower.environmentType || '',
      updatedAt: now,
    },
    merge: true,
  });

  writes.push({
    ref: db.collection('publicSlugClaims').doc(slug),
    data: { uid: grower.uid, trafficBatch: TRAFFIC_BATCH, updatedAt: now },
    merge: false,
  });

  writes.push({
    ref: db.collection('publicGrowerProfiles').doc(slug),
    data: {
      uid: grower.uid,
      slug,
      displayName,
      bio: grower.publicBio || String(grower.notes || '').slice(0, 280),
      growSetup: grower.environmentType || '',
      homeCity: grower.city || '',
      photo: grower.profilePhoto || '',
      postCount: stories.length,
      trafficBatch: TRAFFIC_BATCH,
      updatedAt: now,
    },
    merge: false,
  });

  stories.forEach((story, i) => {
    const postSlug = slugify(story.title);
    const postId = `traffic_${grower.key}_${postSlug}`.slice(0, 80);
    const publishedAt = new Date(Date.now() - (i + 1) * 86400000 * 2).toISOString();
    const privateDoc = {
      title: story.title,
      slug: postSlug,
      body: story.body,
      category: story.category,
      status: 'published',
      coverPhoto: story.coverPhoto || null,
      plantLabel: null,
      createdAt: publishedAt,
      updatedAt: now,
      publishedAt,
      trafficBatch: TRAFFIC_BATCH,
    };
    writes.push({
      ref: db.collection('users').doc(grower.uid).collection('growerPosts').doc(postId),
      data: privateDoc,
      merge: false,
    });
    writes.push({
      ref: db.collection('publicJournalPosts').doc(postId),
      data: {
        title: story.title,
        slug: postSlug,
        body: story.body,
        category: story.category,
        coverPhoto: story.coverPhoto || null,
        publishedAt,
        updatedAt: now,
        hiddenByAdmin: false,
        authorUid: grower.uid,
        author: {
          uid: grower.uid,
          slug,
          displayName,
          photo: grower.profilePhoto || '',
        },
        trafficBatch: TRAFFIC_BATCH,
      },
      merge: false,
    });
  });

  return writes;
}
