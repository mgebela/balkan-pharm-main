/*
 * Scrubbed public grower journal: private posts + profiles → public mirrors.
 * Mirrors only published field notes — never private plant ids, wallets, or drafts.
 */
'use strict';

const {getFirestore, FieldValue} = require('firebase-admin/firestore');

const PUBLIC_POSTS = 'publicJournalPosts';
const PUBLIC_PROFILES = 'publicGrowerProfiles';
const SLUG_CLAIMS = 'publicSlugClaims';

const CATEGORIES = new Set([
  'tip',
  'look',
  'problem',
  'visit',
  'product',
  'daybook',
]);

function trimStr(v, max) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return s.slice(0, max);
}

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 48;
}

/**
 * @param {FirebaseFirestore.DocumentData|null|undefined} post
 * @param {{ uid: string, slug?: string, displayName?: string, photo?: string }} author
 * @return {object|null}
 */
function scrubPublicPost(post, author) {
  if (!post || typeof post !== 'object') return null;
  if (String(post.status || '') !== 'published') return null;
  if (post.hiddenByAdmin === true) return null;

  const title = trimStr(post.title, 120);
  const body = trimStr(post.body, 12000);
  const slug = normalizeSlug(post.slug || title);
  const category = String(post.category || 'daybook');
  if (!title || !body || !isValidSlug(slug) || !CATEGORIES.has(category)) return null;

  const authorSlug = normalizeSlug(author && author.slug);
  const authorName = trimStr(author && author.displayName, 64) || 'Grower';
  if (!isValidSlug(authorSlug)) return null;

  const out = {
    title,
    slug,
    body,
    category,
    publishedAt:
      typeof post.publishedAt === 'string' && post.publishedAt
        ? post.publishedAt
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: {
      uid: String(author.uid || ''),
      slug: authorSlug,
      displayName: authorName,
    },
    hiddenByAdmin: false,
  };

  if (author && typeof author.photo === 'string' && author.photo) {
    const photo = trimStr(author.photo, 500000);
    if (photo.indexOf('https://') === 0 || photo.indexOf('data:image/') === 0) {
      out.author.photo = photo;
    }
  }

  if (typeof post.coverPhoto === 'string' && post.coverPhoto) {
    const cover = trimStr(post.coverPhoto, 500000);
    if (cover.indexOf('https://') === 0 || cover.indexOf('data:image/') === 0) {
      out.coverPhoto = cover;
    }
  }

  if (typeof post.plantLabel === 'string' && post.plantLabel.trim()) {
    out.plantLabel = trimStr(post.plantLabel, 80);
  }

  return out;
}

async function loadAuthor(uid) {
  const db = getFirestore();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    uid,
    slug: d.publicSlug || '',
    displayName: d.displayName || '',
    photo: d.profilePhoto || '',
    bio: d.publicBio || '',
    growSetup: d.growSetup || '',
    homeCity: d.homeCity || d.city || '',
    enabled: d.publicProfileEnabled === true,
    profileType: d.profileType || '',
  };
}

/**
 * Upsert or delete the public mirror for one private post.
 * @param {string} uid
 * @param {string} postId
 * @param {FirebaseFirestore.DocumentData|null|undefined} post
 */
async function syncPublicJournalPost(uid, postId, post) {
  if (!uid || !postId) return;
  const db = getFirestore();
  const ref = db.collection(PUBLIC_POSTS).doc(postId);
  const author = await loadAuthor(uid);
  if (!author || !author.enabled) {
    await ref.delete().catch(() => null);
    return;
  }
  const scrubbed = scrubPublicPost(post, author);
  if (!scrubbed) {
    await ref.delete().catch(() => null);
    await recountPublicPosts(author.slug).catch(() => null);
    return;
  }
  scrubbed.authorUid = uid;
  await ref.set(scrubbed, {merge: false});
  await recountPublicPosts(author.slug).catch(() => null);
}

async function recountPublicPosts(slug) {
  const key = normalizeSlug(slug);
  if (!isValidSlug(key)) return;
  const db = getFirestore();
  const snap = await db
    .collection(PUBLIC_POSTS)
    .where('author.slug', '==', key)
    .where('hiddenByAdmin', '==', false)
    .get();
  const profileRef = db.collection(PUBLIC_PROFILES).doc(key);
  const profile = await profileRef.get();
  if (!profile.exists) return;
  await profileRef.set(
    {
      postCount: snap.size,
      updatedAt: new Date().toISOString(),
    },
    {merge: true},
  );
}

/**
 * Claim / release public slug and mirror grower profile.
 * @param {string} uid
 * @param {FirebaseFirestore.DocumentData|null|undefined} before
 * @param {FirebaseFirestore.DocumentData|null|undefined} after
 */
async function syncPublicGrowerProfile(uid, before, after) {
  if (!uid) return;
  const db = getFirestore();
  const prevSlug = normalizeSlug(before && before.publicSlug);
  const nextSlug = normalizeSlug(after && after.publicSlug);
  const enabled = !!(after && after.publicProfileEnabled === true);
  const isGrower = after && after.profileType === 'grower';

  // Release previous claim if slug changed or profile disabled.
  if (prevSlug && isValidSlug(prevSlug) && (prevSlug !== nextSlug || !enabled || !isGrower)) {
    const claimRef = db.collection(SLUG_CLAIMS).doc(prevSlug);
    const claim = await claimRef.get();
    if (claim.exists && claim.data() && claim.data().uid === uid) {
      await claimRef.delete().catch(() => null);
    }
    await db.collection(PUBLIC_PROFILES).doc(prevSlug).delete().catch(() => null);
  }

  if (!after || !enabled || !isGrower || !isValidSlug(nextSlug)) {
    return;
  }

  const claimRef = db.collection(SLUG_CLAIMS).doc(nextSlug);
  await db.runTransaction(async (tx) => {
    const claim = await tx.get(claimRef);
    if (claim.exists) {
      const owner = claim.data() && claim.data().uid;
      if (owner && owner !== uid) {
        throw new Error('public_slug_taken');
      }
    }
    tx.set(claimRef, {uid, updatedAt: new Date().toISOString()}, {merge: true});
  });

  const displayName = trimStr(after.displayName, 64) || 'Grower';
  const bio = trimStr(after.publicBio, 280);
  const growSetup = trimStr(after.growSetup, 40);
  const homeCity = trimStr(after.homeCity || after.city, 80);
  const photo =
    typeof after.profilePhoto === 'string' && after.profilePhoto
      ? trimStr(after.profilePhoto, 500000)
      : '';

  const profile = {
    uid,
    slug: nextSlug,
    displayName,
    bio,
    growSetup,
    homeCity,
    updatedAt: new Date().toISOString(),
  };
  if (photo && (photo.indexOf('https://') === 0 || photo.indexOf('data:image/') === 0)) {
    profile.photo = photo;
  }

  // Preserve postCount if already counted.
  const existing = await db.collection(PUBLIC_PROFILES).doc(nextSlug).get();
  if (existing.exists && existing.data() && typeof existing.data().postCount === 'number') {
    profile.postCount = existing.data().postCount;
  } else {
    profile.postCount = 0;
  }

  await db.collection(PUBLIC_PROFILES).doc(nextSlug).set(profile, {merge: true});

  // Re-stamp author snapshots on this grower's published posts.
  const posts = await db.collection('users').doc(uid).collection('growerPosts').get();
  for (const doc of posts.docs) {
    await syncPublicJournalPost(uid, doc.id, doc.data()).catch((err) => {
      console.error('resync post after profile', doc.id, err);
    });
  }
}

module.exports = {
  PUBLIC_POSTS,
  PUBLIC_PROFILES,
  SLUG_CLAIMS,
  CATEGORIES,
  normalizeSlug,
  isValidSlug,
  scrubPublicPost,
  syncPublicJournalPost,
  syncPublicGrowerProfile,
  FieldValue,
};
