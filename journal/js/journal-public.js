/**
 * Public grower journal — unauth reads of publicJournalPosts / publicGrowerProfiles.
 * Works on https://growto.live/journal/ and https://journal.growto.live/
 */
(function () {
  'use strict';

  var CATEGORIES = {
    tip: ['journal.cat.tip', 'Tips & tricks'],
    look: ['journal.cat.look', 'Looking at my plants'],
    problem: ['journal.cat.problem', 'Plant problem'],
    visit: ['journal.cat.visit', 'Visited other growers'],
    product: ['journal.cat.product', 'Made from my plants'],
    daybook: ['journal.cat.daybook', 'Field note'],
  };

  var SIGNUP_GROWER = 'https://growto.live/dnevnik/?mode=signup&type=grower';
  var SIGNUP_ADOPTER = 'https://growto.live/dnevnik/?mode=signup&type=adopter';
  var OG_FALLBACK = 'https://growto.live/images/og-growtoo.png';

  function tx(key, fallback, vars) {
    if (typeof window.T === 'function') return window.T(key, fallback, vars);
    if (!vars) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, function (_, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : _;
    });
  }

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

  function journalOrigin() {
    return isJournalHost() ? 'https://journal.growto.live' : 'https://growto.live/journal';
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
      var tag = (window.I18N && I18N.intl) || 'en-GB';
      return new Date(iso).toLocaleDateString(tag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (_) {
      return '';
    }
  }

  function categoryLabel(key) {
    var row = CATEGORIES[key];
    if (!row) return key || tx('journal.cat.daybook', 'Field note');
    return tx(row[0], row[1]);
  }

  function excerpt(body, n) {
    var t = String(body || '')
      .replace(/^photo\s*:.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length <= n) return t;
    return t.slice(0, n).replace(/\s+\S*$/, '') + '…';
  }

  function wordCount(body) {
    var t = String(body || '').replace(/\s+/g, ' ').trim();
    if (!t) return 0;
    return t.split(' ').length;
  }

  function readMins(body) {
    return Math.max(1, Math.round(wordCount(body) / 220));
  }

  function isDeskAuthor(author) {
    var a = author || {};
    var slug = String(a.slug || '');
    var uid = String(a.uid || '');
    var name = String(a.displayName || '');
    return slug === 'growtoo-desk' || uid === 'growtoo-editorial' || /desk/i.test(name);
  }

  function bodyAndCredit(body) {
    var blocks = String(body || '').split(/\n{2,}/);
    var credit = '';
    if (blocks.length) {
      var last = blocks[blocks.length - 1].trim();
      if (/^photo\s*:/i.test(last)) {
        credit = last.replace(/^photo\s*:\s*/i, '');
        blocks.pop();
      }
    }
    var html = blocks
      .map(function (p) {
        return '<p>' + esc(p).replace(/\n/g, '<br />') + '</p>';
      })
      .join('');
    return { html: html, credit: credit };
  }

  function setMeta(sel, attr, value) {
    var el = document.querySelector(sel);
    if (!el || !value) return;
    el.setAttribute(attr, value);
  }

  function setNamedMeta(attr, name, value) {
    if (!value) return;
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  function convertBand() {
    return (
      '<aside class="gj-convert">' +
      '<p class="gj-convert-eye">' +
      esc(tx('journal.post.ctaEyebrow', 'Keep the next cycle')) +
      '</p>' +
      '<h2 class="gj-convert-title">' +
      esc(tx('journal.post.ctaTitle', 'Start a journal like this one')) +
      '</h2>' +
      '<p class="gj-convert-body">' +
      esc(
        tx(
          'journal.post.ctaBody',
          'Watering, feeding, stages, photos — still there next season. Free, no wallet.'
        )
      ) +
      '</p>' +
      '<div class="gj-convert-row">' +
      '<a class="gj-btn gj-btn-primary" href="' +
      SIGNUP_GROWER +
      '">' +
      esc(tx('journal.post.ctaGrow', 'Start a grow')) +
      '</a>' +
      '<a class="gj-btn-quiet" href="' +
      SIGNUP_ADOPTER +
      '">' +
      esc(tx('journal.post.ctaFollow', 'Follow a plant')) +
      '</a>' +
      '</div></aside>'
    );
  }

  function postCard(p) {
    var author = p.author || {};
    var href = postHref(p.slug);
    var desk = isDeskAuthor(author);
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
      '<span class="gj-chip' +
      (desk ? ' gj-chip--desk' : '') +
      '">' +
      esc(
        desk
          ? tx('journal.post.deskKicker', 'Desk article')
          : categoryLabel(p.category)
      ) +
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
        '">' +
        esc(tx('journal.cat.all', 'All')) +
        '</a>' +
        Object.keys(CATEGORIES)
          .map(function (k) {
            return (
              '<a class="gj-filter' +
              (cat === k ? ' is-active' : '') +
              '" href="' +
              esc(feedHref(k)) +
              '">' +
              esc(categoryLabel(k)) +
              '</a>'
            );
          })
          .join('');
    }
    root.innerHTML = '<p class="gj-muted">' + esc(tx('journal.feed.loading', 'Loading field notes…')) + '</p>';
    try {
      var posts = await fetchPosts({ category: cat || null, limit: 48 });
      if (!posts.length) {
        root.innerHTML =
          '<p class="gj-muted">' +
          esc(
            tx(
              'journal.feed.empty',
              'No published stories yet. Growers share tips, plant looks, and harvest notes here — open to everyone, no sign-in.'
            )
          ) +
          '</p>';
        return;
      }
      root.innerHTML = '<div class="gj-grid">' + posts.map(postCard).join('') + '</div>';
    } catch (err) {
      console.error(err);
      root.innerHTML =
        '<p class="gj-muted">' +
        esc(tx('journal.feed.error', 'Could not load the journal. Try again shortly.')) +
        '</p>';
    }
  }

  function applyPostMeta(post, slug) {
    var title = (post.title || 'Story') + ' · growtoo journal';
    var desc = excerpt(post.body, 155);
    var url = journalOrigin() + '/p/?slug=' + encodeURIComponent(slug);
    var image =
      post.coverPhoto && String(post.coverPhoto).indexOf('https://') === 0
        ? post.coverPhoto
        : OG_FALLBACK;
    document.title = title;
    setMeta('meta[name="description"]', 'content', desc);
    setMeta('link[rel="canonical"]', 'href', url);
    setNamedMeta('property', 'og:title', post.title || title);
    setNamedMeta('property', 'og:description', desc);
    setNamedMeta('property', 'og:url', url);
    setNamedMeta('property', 'og:image', image);
    setNamedMeta('property', 'og:type', 'article');
    setNamedMeta('name', 'twitter:card', 'summary_large_image');
    setNamedMeta('name', 'twitter:title', post.title || title);
    setNamedMeta('name', 'twitter:description', desc);
    setNamedMeta('name', 'twitter:image', image);

    var author = post.author || {};
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title || '',
      description: desc,
      datePublished: post.publishedAt || '',
      dateModified: post.updatedAt || post.publishedAt || '',
      image: image,
      mainEntityOfPage: url,
      author: {
        '@type': isDeskAuthor(author) ? 'Organization' : 'Person',
        name: author.displayName || 'Grower',
        url: author.slug ? journalOrigin() + '/g/?slug=' + encodeURIComponent(author.slug) : undefined,
      },
      publisher: {
        '@type': 'Organization',
        name: 'growtoo',
        url: 'https://growto.live/',
      },
    };
    var slot = document.getElementById('gj-jsonld');
    if (!slot) {
      slot = document.createElement('script');
      slot.type = 'application/ld+json';
      slot.id = 'gj-jsonld';
      document.head.appendChild(slot);
    }
    slot.textContent = JSON.stringify(ld);
  }

  function bindReadProgress() {
    var fill = document.querySelector('.gj-progress span');
    var article = document.querySelector('.gj-post-article');
    if (!fill || !article) return;
    function onScroll() {
      var rect = article.getBoundingClientRect();
      var start = window.scrollY + rect.top;
      var h = article.offsetHeight - window.innerHeight;
      var p = h <= 0 ? 1 : (window.scrollY - start + 80) / h;
      fill.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function bindShare(title, url) {
    var btn = document.getElementById('gj-share');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          btn.textContent = '✓';
          setTimeout(function () {
            btn.textContent = tx('journal.post.share', 'Share');
          }, 1600);
        });
      }
    });
  }

  async function renderPost() {
    var root = document.getElementById('gj-post');
    if (!root) return;
    var slug = qs('slug');
    root.innerHTML =
      '<div class="gj-post-skel" aria-busy="true">' +
      '<div class="gj-skel gj-skel-cover"></div>' +
      '<div class="gj-skel gj-skel-line gj-skel-line--wide"></div>' +
      '<div class="gj-skel gj-skel-line"></div>' +
      '<div class="gj-skel gj-skel-line"></div>' +
      '</div>';
    if (!slug) {
      root.innerHTML =
        '<p class="gj-muted">' +
        esc(tx('journal.post.missing', 'This note has no address.')) +
        '</p>' +
        convertBand();
      return;
    }
    try {
      var post = await fetchPostBySlug(slug);
      if (!post) {
        root.innerHTML =
          '<p class="gj-muted">' +
          esc(tx('journal.post.notFound', 'This note is gone, or it was never published.')) +
          '</p>' +
          convertBand();
        return;
      }
      var author = post.author || {};
      var desk = isDeskAuthor(author);
      applyPostMeta(post, slug);

      var more = [];
      if (author.slug) {
        more = await fetchPosts({ authorSlug: author.slug, limit: 6 });
        more = more
          .filter(function (p) {
            return p.slug !== post.slug;
          })
          .slice(0, 3);
      }
      if (more.length < 3) {
        var recent = await fetchPosts({ limit: 8 });
        recent.forEach(function (p) {
          if (more.length >= 3) return;
          if (p.slug === post.slug) return;
          if (more.some(function (m) { return m.slug === p.slug; })) return;
          more.push(p);
        });
      }

      var parsed = bodyAndCredit(post.body);
      var kicker = desk
        ? tx('journal.post.deskKicker', 'Desk article')
        : tx('journal.post.growerKicker', 'Grower note');
      var kind = desk
        ? tx('journal.post.deskKind', 'Written by growtoo desk — not a grower harvest')
        : tx('journal.post.growerKind', 'Logged from a real grow');
      var canShare = typeof navigator !== 'undefined' && (navigator.share || navigator.clipboard);
      var postUrl = journalOrigin() + '/p/?slug=' + encodeURIComponent(slug);
      var byHref = author.slug ? growerHref(author.slug) : feedHref('');

      var facts = [];
      if (post.plantLabel) {
        facts.push(
          '<div><dt>' +
            esc(tx('journal.post.plant', 'Plant')) +
            '</dt><dd>' +
            esc(post.plantLabel) +
            '</dd></div>'
        );
      }
      facts.push(
        '<div><dt>' +
          esc(tx('journal.post.published', 'Published')) +
          '</dt><dd>' +
          esc(formatDate(post.publishedAt)) +
          '</dd></div>'
      );
      facts.push(
        '<div><dt>' +
          esc(tx('journal.post.kind', 'Kind')) +
          '</dt><dd>' +
          esc(kind) +
          '</dd></div>'
      );

      root.innerHTML =
        '<article class="gj-post-article">' +
        (post.coverPhoto
          ? '<figure class="gj-post-cover"><img src="' +
            esc(post.coverPhoto) +
            '" alt="' +
            esc(post.title || '') +
            '" />' +
            (parsed.credit
              ? '<figcaption>' +
                esc(tx('journal.post.photo', 'Photo')) +
                ': ' +
                esc(parsed.credit) +
                '</figcaption>'
              : '') +
            '</figure>'
          : '') +
        '<div class="gj-post-inner">' +
        '<p class="gj-kicker">' +
        '<a href="' +
        esc(feedHref(desk ? '' : post.category)) +
        '">' +
        esc(kicker) +
        '</a>' +
        '<span aria-hidden="true">·</span>' +
        '<a href="' +
        esc(feedHref(post.category)) +
        '">' +
        esc(categoryLabel(post.category)) +
        '</a>' +
        '</p>' +
        '<h1 class="gj-post-title">' +
        esc(post.title) +
        '</h1>' +
        '<p class="gj-dek">' +
        esc(excerpt(post.body, 180)) +
        '</p>' +
        '<div class="gj-byline-row">' +
        '<a class="gj-byline" href="' +
        esc(byHref) +
        '">' +
        (author.photo
          ? '<img class="gj-avatar" src="' + esc(author.photo) + '" alt="" />'
          : '<span class="gj-avatar gj-avatar--mark" aria-hidden="true">' +
            esc((author.displayName || 'G').charAt(0).toUpperCase()) +
            '</span>') +
        '<span><strong>' +
        esc(author.displayName || 'Grower') +
        '</strong>' +
        (post.plantLabel && !desk ? '<em> · ' + esc(post.plantLabel) + '</em>' : '') +
        '<em> · ' +
        esc(formatDate(post.publishedAt)) +
        ' · ' +
        esc(tx('journal.post.minRead', '{n} min read', { n: readMins(post.body) })) +
        '</em></span></a>' +
        (canShare
          ? '<button type="button" class="gj-share" id="gj-share">' +
            esc(tx('journal.post.share', 'Share')) +
            '</button>'
          : '') +
        '</div>' +
        '<dl class="gj-facts">' +
        facts.join('') +
        '</dl>' +
        '<div class="gj-post-body">' +
        parsed.html +
        '</div>' +
        '</div></article>' +
        convertBand() +
        (more.length
          ? '<section class="gj-more"><h2>' +
            esc(
              author.slug &&
                more.every(function (p) {
                  return p.author && p.author.slug === author.slug;
                })
                ? tx('journal.post.moreGrower', 'More from this grower')
                : tx('journal.post.moreNotes', 'More field notes')
            ) +
            '</h2><div class="gj-grid">' +
            more.map(postCard).join('') +
            '</div></section>'
          : '');

      bindReadProgress();
      bindShare(post.title || document.title, postUrl);
    } catch (err) {
      console.error(err);
      root.innerHTML =
        '<p class="gj-muted">' +
        esc(tx('journal.post.loadError', 'Could not load this story.')) +
        '</p>' +
        convertBand();
    }
  }

  async function renderGrower() {
    var root = document.getElementById('gj-grower');
    if (!root) return;
    var slug = qs('slug');
    root.innerHTML = '<p class="gj-muted">' + esc(tx('journal.post.loading', 'Opening the note…')) + '</p>';
    if (!slug) {
      root.innerHTML = '<p class="gj-muted">' + esc(tx('journal.post.missing', 'This note has no address.')) + '</p>';
      return;
    }
    try {
      var grower = await fetchGrower(slug);
      if (!grower) {
        root.innerHTML =
          '<p class="gj-muted">' +
          esc(tx('journal.post.notFound', 'This note is gone, or it was never published.')) +
          '</p>';
        return;
      }
      document.title = (grower.displayName || 'Grower') + ' · growtoo journal';
      var posts = await fetchPosts({ authorSlug: slug, limit: 40 });
      var desk = isDeskAuthor(grower);
      root.innerHTML =
        '<header class="gj-profile">' +
        (grower.photo
          ? '<img class="gj-profile-photo" src="' + esc(grower.photo) + '" alt="" />'
          : '<div class="gj-profile-photo gj-profile-photo--mark" aria-hidden="true">G</div>') +
        '<div class="gj-profile-copy">' +
        '<p class="gj-eyebrow">' +
        esc(
          desk
            ? tx('journal.post.deskKicker', 'Desk article')
            : tx('journal.post.growerKicker', 'Grower note')
        ) +
        '</p>' +
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
        convertBand() +
        '<section class="gj-more"><h2>' +
        esc(tx('journal.post.moreGrower', 'More from this grower')) +
        '</h2>' +
        (posts.length
          ? '<div class="gj-grid">' + posts.map(postCard).join('') + '</div>'
          : '<p class="gj-muted">No published stories yet.</p>') +
        '</section>';
    } catch (err) {
      console.error(err);
      root.innerHTML =
        '<p class="gj-muted">' +
        esc(tx('journal.post.loadError', 'Could not load this story.')) +
        '</p>';
    }
  }

  function boot() {
    var page = document.body && document.body.getAttribute('data-gj-page');
    if (page === 'feed') renderFeed();
    else if (page === 'post') renderPost();
    else if (page === 'grower') renderGrower();
  }

  function start() {
    if (window.I18N && typeof I18N.whenReady === 'function') I18N.whenReady(boot);
    else boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
