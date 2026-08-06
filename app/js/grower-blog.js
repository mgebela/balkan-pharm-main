/**
 * Grower Stories — public field-note blog composer (private Firestore → CF public mirror).
 */
(function (root) {
  'use strict';

  var CATEGORIES = [
    { key: 'tip', label: 'Tips & tricks' },
    { key: 'look', label: 'Looking at my plants' },
    { key: 'problem', label: 'Plant problem' },
    { key: 'visit', label: 'Visited other growers' },
    { key: 'product', label: 'Made from my plants' },
    { key: 'daybook', label: 'Field note' },
  ];

  var editingId = '';
  var coverDataUrl = '';
  var bound = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function db() {
    if (!root.firebase || !firebase.firestore) return null;
    return firebase.firestore();
  }

  function currentUid() {
    try {
      var u = firebase.auth().currentUser;
      return u ? u.uid : '';
    } catch (_) {
      return '';
    }
  }

  function isGrower() {
    try {
      if (root.DnevnikProfile && typeof DnevnikProfile.isGrower === 'function') {
        return !!DnevnikProfile.isGrower();
      }
    } catch (_) {}
    return true;
  }

  function toast(msg, kind) {
    if (root.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
      DnevnikNotifications.toast(msg, kind || 'info');
    } else {
      console.log(msg);
    }
  }

  function slugify(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function categoryLabel(key) {
    var found = CATEGORIES.find(function (c) {
      return c.key === key;
    });
    return found ? found.label : key || 'Field note';
  }

  function postsCol(uid) {
    return db().collection('users').doc(uid).collection('growerPosts');
  }

  function getPlants() {
    try {
      if (root.DnevnikJournal && typeof DnevnikJournal.getPlants === 'function') {
        return DnevnikJournal.getPlants() || [];
      }
    } catch (_) {}
    return [];
  }

  function plantLabel(plant) {
    if (!plant) return '';
    var name = String(plant.name || '').trim();
    var strain = String(plant.strain || '').trim();
    if (strain && name && strain.toLowerCase() !== name.toLowerCase()) {
      return strain + ' · ' + name;
    }
    return strain || name || '';
  }

  function fillPlantSelect() {
    var sel = document.getElementById('blog-plant');
    if (!sel) return;
    var plants = getPlants();
    var prev = sel.value;
    sel.innerHTML =
      '<option value="">No plant link</option>' +
      plants
        .map(function (p) {
          return (
            '<option value="' +
            esc(p.id) +
            '">' +
            esc(plantLabel(p) || p.name || 'Plant') +
            '</option>'
          );
        })
        .join('');
    if (prev) sel.value = prev;
  }

  function fillCategorySelect() {
    var sel = document.getElementById('blog-category');
    if (!sel || sel.options.length) return;
    sel.innerHTML = CATEGORIES.map(function (c) {
      return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
    }).join('');
  }

  function setStatus(msg, kind) {
    var el = document.getElementById('blog-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'blog-status' + (kind ? ' blog-status--' + kind : '');
  }

  function resetForm() {
    editingId = '';
    coverDataUrl = '';
    var form = document.getElementById('blog-form');
    if (form) form.reset();
    fillCategorySelect();
    fillPlantSelect();
    var preview = document.getElementById('blog-cover-preview');
    if (preview) preview.innerHTML = '';
    var idEl = document.getElementById('blog-edit-id');
    if (idEl) idEl.value = '';
    var titleEl = document.getElementById('blog-composer-title');
    if (titleEl) titleEl.textContent = 'New story';
    setStatus('');
  }

  function loadPostIntoForm(post) {
    editingId = post.id || '';
    var idEl = document.getElementById('blog-edit-id');
    if (idEl) idEl.value = editingId;
    var titleEl = document.getElementById('blog-title');
    var slugEl = document.getElementById('blog-slug');
    var bodyEl = document.getElementById('blog-body');
    var catEl = document.getElementById('blog-category');
    var plantEl = document.getElementById('blog-plant');
    if (titleEl) titleEl.value = post.title || '';
    if (slugEl) slugEl.value = post.slug || '';
    if (bodyEl) bodyEl.value = post.body || '';
    if (catEl) catEl.value = post.category || 'daybook';
    if (plantEl) plantEl.value = post.plantId || '';
    coverDataUrl = post.coverPhoto || '';
    var preview = document.getElementById('blog-cover-preview');
    if (preview) {
      preview.innerHTML = coverDataUrl
        ? '<img src="' + esc(coverDataUrl) + '" alt="" />'
        : '';
    }
    var heading = document.getElementById('blog-composer-title');
    if (heading) heading.textContent = 'Edit story';
    var composer = document.getElementById('blog-composer');
    if (composer) composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readForm() {
    var title = String((document.getElementById('blog-title') || {}).value || '').trim();
    var slugRaw = String((document.getElementById('blog-slug') || {}).value || '').trim();
    var body = String((document.getElementById('blog-body') || {}).value || '').trim();
    var category = String((document.getElementById('blog-category') || {}).value || 'daybook');
    var plantId = String((document.getElementById('blog-plant') || {}).value || '').trim();
    var slug = slugify(slugRaw || title);
    var plant = getPlants().find(function (p) {
      return p && String(p.id) === plantId;
    });
    return {
      title: title.slice(0, 120),
      slug: slug,
      body: body.slice(0, 12000),
      category: category,
      plantId: plantId || null,
      plantLabel: plant ? plantLabel(plant) : null,
      coverPhoto: coverDataUrl || null,
    };
  }

  function validate(data) {
    if (!data.title) return 'Add a title.';
    if (!data.body) return 'Write a short body.';
    if (!data.slug || data.slug.length < 3) return 'Slug needs at least 3 characters.';
    if (!CATEGORIES.some(function (c) { return c.key === data.category; })) {
      return 'Pick a category.';
    }
    return '';
  }

  async function savePost(status) {
    var uid = currentUid();
    if (!uid) {
      toast('Sign in to publish stories.', 'warn');
      return;
    }
    var data = readForm();
    var err = validate(data);
    if (err) {
      setStatus(err, 'error');
      toast(err, 'warn');
      return;
    }
    var now = new Date().toISOString();
    var payload = {
      title: data.title,
      slug: data.slug,
      body: data.body,
      category: data.category,
      status: status,
      updatedAt: now,
    };
    if (data.plantId) payload.plantId = data.plantId;
    if (data.plantLabel) payload.plantLabel = data.plantLabel;
    if (data.coverPhoto) payload.coverPhoto = data.coverPhoto;

    if (status === 'published') {
      payload.publishedAt = now;
    }

    setStatus('Saving…');
    try {
      var col = postsCol(uid);
      if (editingId) {
        var updatePayload = Object.assign({}, payload);
        if (!data.plantId) updatePayload.plantId = firebase.firestore.FieldValue.delete();
        if (!data.plantLabel) updatePayload.plantLabel = firebase.firestore.FieldValue.delete();
        if (!data.coverPhoto) updatePayload.coverPhoto = firebase.firestore.FieldValue.delete();
        await col.doc(editingId).set(updatePayload, { merge: true });
      } else {
        payload.createdAt = now;
        var ref = await col.add(payload);
        editingId = ref.id;
        var idEl = document.getElementById('blog-edit-id');
        if (idEl) idEl.value = editingId;
      }
      var msg =
        status === 'published'
          ? 'Published — live on the public journal shortly.'
          : status === 'unpublished'
            ? 'Unpublished — removed from the public journal.'
            : 'Draft saved.';
      setStatus(msg, 'ok');
      toast(msg, 'success');
      await renderList();
    } catch (e) {
      console.error(e);
      var m = (e && e.message) || 'Could not save story.';
      setStatus(m, 'error');
      toast(m, 'error');
    }
  }

  function statusBadge(status) {
    var s = String(status || 'draft');
    return '<span class="blog-badge blog-badge--' + esc(s) + '">' + esc(s) + '</span>';
  }

  async function renderList() {
    var list = document.getElementById('blog-list');
    if (!list) return;
    var uid = currentUid();
    if (!uid) {
      list.innerHTML = '<p class="blog-empty">Sign in to manage stories.</p>';
      return;
    }
    list.innerHTML = '<p class="blog-empty">Loading…</p>';
    try {
      var snap = await postsCol(uid).orderBy('updatedAt', 'desc').limit(50).get();
      if (snap.empty) {
        list.innerHTML =
          '<p class="blog-empty">No stories yet. Share a tip, a plant look, or a problem you solved.</p>';
        return;
      }
      list.innerHTML = snap.docs
        .map(function (doc) {
          var p = doc.data() || {};
          var id = doc.id;
          var publicUrl =
            p.status === 'published' && p.slug
              ? 'https://journal.growto.live/p/?slug=' + encodeURIComponent(p.slug)
              : '';
          return (
            '<article class="blog-card" data-post-id="' +
            esc(id) +
            '">' +
            (p.coverPhoto
              ? '<div class="blog-card-photo"><img src="' + esc(p.coverPhoto) + '" alt="" /></div>'
              : '') +
            '<div class="blog-card-body">' +
            '<div class="blog-card-meta">' +
            statusBadge(p.status) +
            '<span class="blog-card-cat">' +
            esc(categoryLabel(p.category)) +
            '</span>' +
            '</div>' +
            '<h3 class="blog-card-title">' +
            esc(p.title || 'Untitled') +
            '</h3>' +
            '<p class="blog-card-excerpt">' +
            esc(String(p.body || '').slice(0, 140)) +
            (String(p.body || '').length > 140 ? '…' : '') +
            '</p>' +
            '<div class="blog-card-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-blog-edit="' +
            esc(id) +
            '">Edit</button>' +
            (p.status === 'published'
              ? '<button type="button" class="btn btn-ghost btn-sm" data-blog-unpublish="' +
                esc(id) +
                '">Unpublish</button>'
              : '<button type="button" class="btn btn-primary btn-sm" data-blog-publish="' +
                esc(id) +
                '">Publish</button>') +
            '<button type="button" class="btn btn-ghost btn-sm" data-blog-delete="' +
            esc(id) +
            '">Delete</button>' +
            (publicUrl
              ? '<a class="btn btn-ghost btn-sm" href="' +
                esc(publicUrl) +
                '" target="_blank" rel="noopener">View live</a>'
              : '') +
            '</div></div></article>'
          );
        })
        .join('');
    } catch (e) {
      console.error(e);
      list.innerHTML =
        '<p class="blog-empty">Could not load stories. Check Firestore rules / connection.</p>';
    }
  }

  async function fetchPost(id) {
    var uid = currentUid();
    if (!uid || !id) return null;
    var snap = await postsCol(uid).doc(id).get();
    if (!snap.exists) return null;
    return Object.assign({ id: snap.id }, snap.data());
  }

  async function quickSetStatus(id, status) {
    var uid = currentUid();
    if (!uid) return;
    var patch = { status: status, updatedAt: new Date().toISOString() };
    if (status === 'published') patch.publishedAt = patch.updatedAt;
    await postsCol(uid).doc(id).set(patch, { merge: true });
    toast(status === 'published' ? 'Published' : 'Unpublished', 'success');
    await renderList();
  }

  async function deletePost(id) {
    var uid = currentUid();
    if (!uid) return;
    if (!window.confirm('Delete this story?')) return;
    await postsCol(uid).doc(id).delete();
    if (editingId === id) resetForm();
    toast('Story deleted', 'success');
    await renderList();
  }

  function bindCoverInput() {
    var input = document.getElementById('blog-cover');
    var clearBtn = document.getElementById('blog-cover-clear');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (!file.type || file.type.indexOf('image/') !== 0) {
          toast('Use a JPG or PNG photo.', 'warn');
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result || '');
          // Soft cap ~450KB string; larger images still allowed but warn.
          if (dataUrl.length > 450000) {
            toast('Photo is large — consider a smaller image for faster loads.', 'warn');
          }
          coverDataUrl = dataUrl;
          var preview = document.getElementById('blog-cover-preview');
          if (preview) {
            preview.innerHTML = '<img src="' + esc(dataUrl) + '" alt="" />';
          }
        };
        reader.readAsDataURL(file);
      });
    }
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = '1';
      clearBtn.addEventListener('click', function () {
        coverDataUrl = '';
        if (input) input.value = '';
        var preview = document.getElementById('blog-cover-preview');
        if (preview) preview.innerHTML = '';
      });
    }
  }

  function bindForm() {
    var draftBtn = document.getElementById('blog-save-draft');
    var pubBtn = document.getElementById('blog-publish');
    var unpubBtn = document.getElementById('blog-unpublish');
    var newBtn = document.getElementById('blog-new');
    var titleEl = document.getElementById('blog-title');
    var slugEl = document.getElementById('blog-slug');

    if (draftBtn && !draftBtn.dataset.bound) {
      draftBtn.dataset.bound = '1';
      draftBtn.addEventListener('click', function () {
        savePost('draft');
      });
    }
    if (pubBtn && !pubBtn.dataset.bound) {
      pubBtn.dataset.bound = '1';
      pubBtn.addEventListener('click', function () {
        savePost('published');
      });
    }
    if (unpubBtn && !unpubBtn.dataset.bound) {
      unpubBtn.dataset.bound = '1';
      unpubBtn.addEventListener('click', function () {
        if (!editingId) {
          toast('Save the story first.', 'warn');
          return;
        }
        savePost('unpublished');
      });
    }
    if (newBtn && !newBtn.dataset.bound) {
      newBtn.dataset.bound = '1';
      newBtn.addEventListener('click', function () {
        resetForm();
        var composer = document.getElementById('blog-composer');
        if (composer) {
          composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        var titleEl = document.getElementById('blog-title');
        if (titleEl) {
          window.setTimeout(function () {
            titleEl.focus();
          }, 200);
        }
      });
    }
    if (titleEl && slugEl && !titleEl.dataset.slugBound) {
      titleEl.dataset.slugBound = '1';
      titleEl.addEventListener('blur', function () {
        if (!slugEl.value.trim() && titleEl.value.trim()) {
          slugEl.value = slugify(titleEl.value);
        }
      });
    }

    var list = document.getElementById('blog-list');
    if (list && !list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', function (e) {
        var edit = e.target.closest('[data-blog-edit]');
        var pub = e.target.closest('[data-blog-publish]');
        var unpub = e.target.closest('[data-blog-unpublish]');
        var del = e.target.closest('[data-blog-delete]');
        if (edit) {
          fetchPost(edit.getAttribute('data-blog-edit')).then(function (p) {
            if (p) loadPostIntoForm(p);
          });
        } else if (pub) {
          quickSetStatus(pub.getAttribute('data-blog-publish'), 'published');
        } else if (unpub) {
          quickSetStatus(unpub.getAttribute('data-blog-unpublish'), 'unpublished');
        } else if (del) {
          deletePost(del.getAttribute('data-blog-delete'));
        }
      });
    }
  }

  function render() {
    if (!isGrower()) return;
    fillCategorySelect();
    fillPlantSelect();
    bindCoverInput();
    bindForm();
    renderList();
    renderPublicProfileBanner();
  }

  async function renderPublicProfileBanner() {
    var el = document.getElementById('blog-profile-banner');
    if (!el) return;
    var uid = currentUid();
    if (!uid) {
      el.hidden = true;
      return;
    }
    try {
      var snap = await db().collection('users').doc(uid).get();
      var d = snap.exists ? snap.data() || {} : {};
      var enabled = d.publicProfileEnabled === true;
      var slug = String(d.publicSlug || '').trim();
      if (enabled && slug) {
        el.hidden = false;
        el.innerHTML =
          '<p>Public profile live at <a href="https://journal.growto.live/g/?slug=' +
          encodeURIComponent(slug) +
          '" target="_blank" rel="noopener">journal.growto.live/g/' +
          esc(slug) +
          '</a>. Manage it in Account.</p>';
      } else {
        el.hidden = false;
        el.innerHTML =
          '<p>Enable a <strong>public grower profile</strong> in Account (slug + bio) so published stories show your name on <a href="https://journal.growto.live/" target="_blank" rel="noopener">journal.growto.live</a>.</p>';
      }
    } catch (_) {
      el.hidden = true;
    }
  }

  /** Account sheet: public profile fields (grower only). */
  function publicProfileFieldsHtml(profile) {
    var p = profile || {};
    var enabled = p.publicProfileEnabled === true;
    var slug = String(p.publicSlug || '').trim();
    var bio = String(p.publicBio || '').trim();
    return (
      '<div class="account-public-profile" id="account-public-profile">' +
      '<h3 class="account-public-title">Public journal profile</h3>' +
      '<p class="account-public-hint">Required to publish Stories on growto.live/journal.</p>' +
      '<label class="account-public-check">' +
      '<input type="checkbox" id="account-public-enabled"' +
      (enabled ? ' checked' : '') +
      ' /> Enable public profile</label>' +
      '<label>Profile URL slug' +
      '<input type="text" id="account-public-slug" maxlength="48" placeholder="e.g. luka-zagreb" value="' +
      esc(slug) +
      '" /></label>' +
      '<label>Short bio' +
      '<textarea id="account-public-bio" maxlength="280" rows="3" placeholder="Where you grow, what you share…">' +
      esc(bio) +
      '</textarea></label>' +
      '<div class="account-profile-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" id="account-public-save">Save public profile</button>' +
      (enabled && slug
        ? '<a class="btn btn-ghost btn-sm" href="https://journal.growto.live/g/?slug=' +
          encodeURIComponent(slug) +
          '" target="_blank" rel="noopener">Preview</a>'
        : '') +
      '</div>' +
      '<p class="account-public-status" id="account-public-status" hidden></p>' +
      '</div>'
    );
  }

  function bindPublicProfileActions() {
    var save = document.getElementById('account-public-save');
    if (!save || save.dataset.bound === '1') return;
    save.dataset.bound = '1';
    save.addEventListener('click', async function () {
      var uid = currentUid();
      var status = document.getElementById('account-public-status');
      if (!uid) return;
      var enabled = !!(document.getElementById('account-public-enabled') || {}).checked;
      var slug = slugify((document.getElementById('account-public-slug') || {}).value || '');
      var bio = String((document.getElementById('account-public-bio') || {}).value || '')
        .trim()
        .slice(0, 280);
      if (enabled && (!slug || slug.length < 3)) {
        if (status) {
          status.hidden = false;
          status.textContent = 'Pick a slug of at least 3 characters.';
        }
        return;
      }
      try {
        await db()
          .collection('users')
          .doc(uid)
          .set(
            {
              publicProfileEnabled: enabled,
              publicSlug: slug || firebase.firestore.FieldValue.delete(),
              publicBio: bio || firebase.firestore.FieldValue.delete(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        try {
          localStorage.setItem('dnevnik-live-public-slug', slug);
          localStorage.setItem('dnevnik-live-public-enabled', enabled ? '1' : '0');
        } catch (_) {}
        if (status) {
          status.hidden = false;
          status.textContent = enabled
            ? 'Public profile saved. Stories will attribute to journal.growto.live/g/' + slug
            : 'Public profile disabled.';
        }
        toast('Public profile saved', 'success');
        renderPublicProfileBanner();
      } catch (e) {
        console.error(e);
        if (status) {
          status.hidden = false;
          status.textContent = (e && e.message) || 'Could not save.';
        }
        toast('Could not save public profile', 'error');
      }
    });
  }

  root.GrowerBlog = {
    render: render,
    resetForm: resetForm,
    publicProfileFieldsHtml: publicProfileFieldsHtml,
    bindPublicProfileActions: bindPublicProfileActions,
    categories: CATEGORIES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
