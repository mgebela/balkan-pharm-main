#!/usr/bin/env node
/**
 * Publish editorial field notes to journal.growto.live (Admin SDK).
 *
 * Usage (from chain/): node traffic/publish-editorial-journal.js
 */
import { initTraffic, commitBatches } from './helpers.js';
import { EDITORIAL_AUTHOR, EDITORIAL_ARTICLES, coverUrl } from './editorial-articles.js';

async function main() {
  const { db } = initTraffic();
  const now = new Date().toISOString();
  const { uid, slug, displayName, bio, homeCity, growSetup } = EDITORIAL_AUTHOR;
  const writes = [];

  writes.push({
    ref: db.collection('users').doc(uid),
    data: {
      displayName,
      publicProfileEnabled: true,
      publicSlug: slug,
      publicBio: bio,
      homeCity,
      growSetup,
      profileType: 'grower',
      updatedAt: now,
    },
    merge: true,
  });

  writes.push({
    ref: db.collection('publicSlugClaims').doc(slug),
    data: { uid, updatedAt: now },
    merge: true,
  });

  writes.push({
    ref: db.collection('publicGrowerProfiles').doc(slug),
    data: {
      uid,
      slug,
      displayName,
      bio,
      growSetup,
      homeCity,
      postCount: EDITORIAL_ARTICLES.length,
      updatedAt: now,
    },
    merge: true,
  });

  EDITORIAL_ARTICLES.forEach((story, i) => {
    const publishedAt = new Date(Date.now() - (EDITORIAL_ARTICLES.length - i) * 3600000 * 6).toISOString();
    const coverPhoto = coverUrl(story);
    const privateDoc = {
      title: story.title,
      slug: story.id.replace(/^editorial-/, ''),
      body: story.body,
      category: story.category,
      status: 'published',
      coverPhoto,
      plantLabel: null,
      createdAt: publishedAt,
      updatedAt: now,
      publishedAt,
    };
    writes.push({
      ref: db.collection('users').doc(uid).collection('growerPosts').doc(story.id),
      data: privateDoc,
      merge: false,
    });
    writes.push({
      ref: db.collection('publicJournalPosts').doc(story.id),
      data: {
        title: story.title,
        slug: privateDoc.slug,
        body: story.body,
        category: story.category,
        coverPhoto,
        publishedAt,
        updatedAt: now,
        hiddenByAdmin: false,
        authorUid: uid,
        author: { uid, slug, displayName },
      },
      merge: false,
    });
  });

  await commitBatches(db, writes);
  console.log(`Published ${EDITORIAL_ARTICLES.length} notes → https://journal.growto.live/`);
  console.log(`Profile → https://journal.growto.live/g/?slug=${slug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
