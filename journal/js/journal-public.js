/**
 * Public grower journal — unauth reads of publicJournalPosts / publicGrowerProfiles.
 * Works on https://growto.live/journal/ and https://journal.growto.live/
 */
(function () {
  'use strict';

  var CATEGORIES = {
    tip: 'Tips & tricks',
    look: 'Looking at my plants',
    problem: 'Plant problem',
    visit: 'Visited other growers',
    product: 'Made from my plants',
    daybook: 'Field note',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function db() {
    if (!window.firebase || !firebase.firestore) return null;
    return firebase.firestore();
  }

  function qs(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (_) {
      return '';
    }
  }

  function isJournalHost() {
    return /(^|\.)journal\.growto\.live$/i.test(String(location.hostname || ''));
  }

  /** Browser path prefix for journal routes ('' on subdomain, '/journal' on apex). */
  function journalBase() {
    if (isJournalHost()) return '';
    if (/\/journal(\/|$)/i.test(location.pathname || '')) return '/journal';
    return '/journal';
  }

  function postHref(slug) {
    return journalBase() + '/p/?slug=' + encodeURIComponent(slug || '');
  }

  function growerHref(slug) {
    return journalBase() + '/g/?slug=' + encodeURIComponent(slug || '');
  }

  function feedHref(cat) {
    var base = journalBase() + '/';
    if (!cat) return base;
    return base + '?cat=' + encodeURIComponent(cat);
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (_) {
      return '';
    }
  }

  function categoryLabel(key) {
    return CATEGORIES[key] || key || 'Field note';
  }

  function excerpt(body, n) {
    var t = String(body || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    return t.slice(0, n).replace(/\s+\S*$/, '') + '…';
  }

  function bodyHtml(body) {
    return String(body || '')
      .split(/\n{2,}/)
      .map(function (p) {
        return '<p>' + esc(p).replace(/\n/g, '<br />') + '</p>';
      })
      .join('');
  }

  function postCard(p) {
    var author = p.author || {};
    var href = postHref(p.slug);
    return (
      '<article class="gj-card">' +
      '<a class="gj-card-link" href="' +
      esc(href) +
      '">' +
      (p.coverPhoto
        ? '<div class="gj-card-photo"><img src="' + esc(p.coverPhoto) + '" alt="" loading="lazy" /></div>'
        : '<div class="gj-card-photo gj-card-photo--empty" aria-hidden="true"></div>') +
      '<div class="gj-card-copy">' +
      '<div class="gj-card-meta">' +
      '<span class="gj-chip">' +
      esc(categoryLabel(p.category)) +
      '</span>' +
      '<time>' +
      esc(formatDate(p.publishedAt)) +
      '</time>' +
      '</div>' +
      '<h2 class="gj-card-title">' +
      esc(p.title || 'Untitled') +
      '</h2>' +
      '<p class="gj-card-excerpt">' +
      esc(excerpt(p.body, 160)) +
      '</p>' +
      '<p class="gj-card-by">' +
      esc(author.displayName || 'Grower') +
      (p.plantLabel ? ' · ' + esc(p.plantLabel) : '') +
      '</p>' +
      '</div></a></article>'
    );
  }

  async function fetchPosts(opts) {
    var o = opts || {};
    var firestore = db();
    if (!firestore) return [];
    var q = firestore.collection('publicJournalPosts').where('hiddenByAdmin', '==', false);
    if (o.category) q = q.where('category', '==', o.category);
    if (o.authorSlug) q = q.where('author.slug', '==', o.authorSlug);
    try {
      var snap = await q.orderBy('publishedAt', 'desc').limit(o.limit || 40).get();
      return snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
    } catch (err) {
      console.warn('journal query fallback', err);
      var snap2 = await firestore.collection('publicJournalPosts').limit(80).get();
      var rows = snap2.docs
        .map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        })
        .filter(function (p) {
          if (p.hiddenByAdmin) return false;
          if (o.category && p.category !== o.category) return false;
          if (o.authorSlug && (!p.author || p.author.slug !== o.authorSlug)) return false;
          return true;
        });
      rows.sort(function (a, b) {
        return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
      });
      return rows.slice(0, o.limit || 40);
    }
  }

  async function fetchPostBySlug(slug) {
    var firestore = db();
    if (!firestore || !slug) return null;
    try {
      var snap = await firestore
        .collection('publicJournalPosts')
        .where('slug', '==', slug)
        .limit(5)
        .get();
      var hit = snap.docs
        .map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        })
        .find(function (p) {
          return !p.hiddenByAdmin;
        });
      return hit || null;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async function fetchGrower(slug) {
    var firestore = db();
    if (!firestore || !slug) return null;
    var snap = await firestore.collection('publicGrowerProfiles').doc(slug).get();
    if (!snap.exists) return null;
    return Object.assign({ slug: snap.id }, snap.data());
  }

  async function renderFeed() {
    var root = document.getElementById('gj-feed');
    var filters = document.getElementById('gj-filters');
    if (!root) return;
    var cat = qs('cat') || '';
    if (filters) {
      filters.innerHTML =
        '<a class="gj-filter' +
        (!cat ? ' is-active' : '') +
        '" href="' +
        esc(feedHref('')) +
        '">All</a>' +
        Object.keys(CATEGORIES)
          .map(function (k) {
            return (
              '<a class="gj-filter' +
              (cat === k ? ' is-active' : '') +
              '" href="' +
              esc(feedHref(k)) +
              '">' +
              esc(CATEGORIES[k]) +
              '</a>'
            );
          })
          .join('');
    }
    root.innerHTML = '<p class="gj-muted">Loading field notes…</p>';
    try {
      var posts = await fetchPosts({ category: cat || null, limit: 48 });
      if (!posts.length) {
        root.innerHTML =
          '<p class="gj-muted">No published stories yet. Growers share tips, plant looks, and harvest products here — open to everyone, no sign-in.</p>';
        return;
      }
      root.innerHTML = '<div class="gj-grid">' + posts.map(postCard).join('') + '</div>';
    } catch (err) {
      console.error(err);
      root.innerHTML = '<p class="gj-muted">Could not load the journal. Try again shortly.</p>';
    }
  }

  async function renderPost() {
    var root = document.getElementById('gj-post');
    if (!root) return;
    var slug = qs('slug');
    root.innerHTML = '<p class="gj-muted">Loading…</p>';
    if (!slug) {
      root.innerHTML = '<p class="gj-muted">Missing story slug.</p>';
      return;
    }
    try {
      var post = await fetchPostBySlug(slug);
      if (!post) {
        root.innerHTML = '<p class="gj-muted">Story not found or unpublished.</p>';
        return;
      }
      var author = post.author || {};
      document.title = (post.title || 'Story') + ' · growtoo journal';
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', excerpt(post.body, 155));
      var canon = document.querySelector('link[rel="canonical"]');
      if (canon) {
        canon.setAttribute(
          'href',
          (isJournalHost() ? 'https://journal.growto.live' : 'https://growto.live/journal') +
            '/p/?slug=' +
            encodeURIComponent(slug)
        );
      }

      var more = [];
      if (author.slug) {
        more = await fetchPosts({ authorSlug: author.slug, limit: 4 });
        more = more
          .filter(function (p) {
            return p.slug !== post.slug;
          })
          .slice(0, 3);
      }

      root.innerHTML =
        '<article class="gj-article">' +
        (post.coverPhoto
          ? '<div class="gj-hero"><img src="' + esc(post.coverPhoto) + '" alt="" /></div>'
          : '') +
        '<header class="gj-article-head">' +
        '<div class="gj-card-meta">' +
        '<span class="gj-chip">' +
        esc(categoryLabel(post.category)) +
        '</span>' +
        '<time>' +
        esc(formatDate(post.publishedAt)) +
        '</time>' +
        '</div>' +
        '<h1 class="gj-article-title">' +
        esc(post.title) +
        '</h1>' +
        '<a class="gj-byline" href="' +
        esc(growerHref(author.slug || '')) +
        '">' +
        (author.photo
          ? '<img class="gj-avatar" src="' + esc(author.photo) + '" alt="" />'
          : '<span class="gj-avatar gj-avatar--mark" aria-hidden="true">G</span>') +
        '<span>' +
        esc(author.displayName || 'Grower') +
        (post.plantLabel ? '<em> · ' + esc(post.plantLabel) + '</em>' : '') +
        '</span></a>' +
        '</header>' +
        '<div class="gj-article-body">' +
        bodyHtml(post.body) +
        '</div>' +
        '</article>' +
        (more.length
          ? '<section class="gj-more"><h2>More from this grower</h2><div class="gj-grid">' +
            more.map(postCard).join('') +
            '</div></section>'
          : '');
    } catch (err) {
      console.error(err);
      root.innerHTML = '<p class="gj-muted">Could not load this story.</p>';
    }
  }

  async function renderGrower() {
    var root = document.getElementById('gj-grower');
    if (!root) return;
    var slug = qs('slug');
    root.innerHTML = '<p class="gj-muted">Loading…</p>';
    if (!slug) {
      root.innerHTML = '<p class="gj-muted">Missing grower slug.</p>';
      return;
    }
    try {
      var grower = await fetchGrower(slug);
      if (!grower) {
        root.innerHTML = '<p class="gj-muted">Grower profile not found.</p>';
        return;
      }
      document.title = (grower.displayName || 'Grower') + ' · growtoo journal';
      var posts = await fetchPosts({ authorSlug: slug, limit: 40 });
      root.innerHTML =
        '<header class="gj-profile">' +
        (grower.photo
          ? '<img class="gj-profile-photo" src="' + esc(grower.photo) + '" alt="" />'
          : '<div class="gj-profile-photo gj-profile-photo--mark" aria-hidden="true">G</div>') +
        '<div class="gj-profile-copy">' +
        '<p class="gj-eyebrow">Grower journal</p>' +
        '<h1 class="gj-profile-name">' +
        esc(grower.displayName || 'Grower') +
        '</h1>' +
        (grower.bio ? '<p class="gj-profile-bio">' + esc(grower.bio) + '</p>' : '') +
        '<p class="gj-profile-meta">' +
        esc(
          [grower.growSetup, grower.homeCity].filter(Boolean).join(' · ') ||
            'growtoo field notes'
        ) +
        ' · ' +
        esc(String(posts.length)) +
        ' stor' +
        (posts.length === 1 ? 'y' : 'ies') +
        '</p>' +
        '</div></header>' +
        '<section class="gj-more"><h2>Stories</h2>' +
        (posts.length
          ? '<div class="gj-grid">' + posts.map(postCard).join('') + '</div>'
          : '<p class="gj-muted">No published stories yet.</p>') +
        '</section>';
    } catch (err) {
      console.error(err);
      root.innerHTML = '<p class="gj-muted">Could not load this grower.</p>';
    }
  }

  function boot() {
    var page = document.body && document.body.getAttribute('data-gj-page');
    if (page === 'feed') renderFeed();
    else if (page === 'post') renderPost();
    else if (page === 'grower') renderGrower();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
