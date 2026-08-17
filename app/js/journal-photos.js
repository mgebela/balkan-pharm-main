/**
 * Journal photos in Firebase Storage.
 *
 * Photos used to be base64 data URIs stored inline on plant and entry records,
 * which meant they travelled into users/{uid}/app/state — a single Firestore
 * document with a hard 1 MiB ceiling. Nine attachments were enough to cross it,
 * after which every cloud write failed and the journal silently stopped backing
 * up. Photos now go to Storage and the records keep a short download URL.
 *
 * Degrading gracefully matters here: if the bucket is unreachable (not yet
 * enabled, offline, rules rejected) an upload must not throw away the grower's
 * photo. It falls back to the old inline form and reports that it did, so the
 * caller can warn. The sync size guard in app.js is what stops an inline
 * fallback from quietly breaking backup again.
 */
(function () {
  'use strict';

  /** Matches the per-photo compression cap in app.js / grow-camera.js. */
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  function storage() {
    try {
      if (window.firebase && window.firebase.storage) return window.firebase.storage();
    } catch (_) {
      /* SDK missing or app not initialised */
    }
    return null;
  }

  function currentUid() {
    try {
      if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) {
        return window.firebase.auth().currentUser.uid;
      }
    } catch (_) {
      /* not signed in */
    }
    return null;
  }

  function isDataUrl(value) {
    return typeof value === 'string' && value.indexOf('data:') === 0;
  }

  function isRemoteUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  /* The error strings below never reach a grower — they are returned to the
     caller, which logs them with console.warn and shows the photo inline
     anyway. i18n-ignore keeps them out of the translation worklist. */

  /** data:image/jpeg;base64,… → Blob, without a fetch() round trip. */
  function dataUrlToBlob(dataUrl) {
    var match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('Not a data URL'); // i18n-ignore
    var mime = match[1] || 'image/jpeg';
    var isBase64 = !!match[2];
    var payload = match[3] || '';
    var bytes;
    if (isBase64) {
      var binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return new Blob([bytes], { type: mime });
  }

  function photoPath(uid, kind) {
    var stamp = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 8);
    var safeKind = String(kind || 'photo').replace(/[^a-z0-9-]/gi, '') || 'photo';
    return 'users/' + uid + '/journal/' + safeKind + '-' + stamp + '-' + rand + '.jpg';
  }

  /**
   * Upload one data URL and return where it ended up.
   *
   * @param {string} dataUrl Source image as a data URL.
   * @param {string} kind Short label used in the object name (plant / entry).
   * @return {!Promise<{url: string, inline: boolean, error: ?string}>}
   *     `inline: true` means the upload did not happen and `url` is still the
   *     original data URL — usable, but it counts against the journal document.
   */
  async function upload(dataUrl, kind) {
    if (!isDataUrl(dataUrl)) {
      // Already a Storage URL (or empty) — nothing to do.
      return { url: dataUrl, inline: false, error: null };
    }
    var st = storage();
    var uid = currentUid();
    if (!st || !uid) {
      return {
        url: dataUrl,
        inline: true,
        error: !uid ? 'Not signed in' : 'Storage unavailable', // i18n-ignore
      };
    }
    try {
      var blob = dataUrlToBlob(dataUrl);
      if (blob.size > MAX_UPLOAD_BYTES) {
        // i18n-ignore
        return { url: dataUrl, inline: true, error: 'Photo is too large to upload' };
      }
      var ref = st.ref(photoPath(uid, kind));
      await ref.put(blob, {
        contentType: blob.type || 'image/jpeg',
        // Photos are immutable once written — the name carries a fresh id.
        cacheControl: 'public, max-age=31536000',
      });
      var url = await ref.getDownloadURL();
      return { url: url, inline: false, error: null };
    } catch (err) {
      return {
        url: dataUrl,
        inline: true,
        error: (err && (err.code || err.message)) || 'Upload failed', // i18n-ignore
      };
    }
  }

  /**
   * Move any still-inline photos on the given records into Storage.
   *
   * Uploads run one at a time rather than in parallel: a grower migrating a
   * full journal on a phone should not open a dozen simultaneous uploads. Each
   * record is rewritten only after its own upload succeeds, so an interrupted
   * run leaves a consistent mix of migrated and not-yet-migrated records and
   * can simply be run again.
   *
   * @param {!Array<!Object>} records Plants or entries (mutated in place).
   * @param {string} kind Short label for the object name.
   * @return {!Promise<{moved: number, failed: number, bytesFreed: number}>}
   */
  async function migrateRecords(records, kind) {
    var moved = 0;
    var failed = 0;
    var bytesFreed = 0;
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec || !isDataUrl(rec.photo)) continue;
      var before = rec.photo.length;
      /* eslint-disable no-await-in-loop */
      var res = await upload(rec.photo, kind);
      /* eslint-enable no-await-in-loop */
      if (res.inline) {
        failed++;
        continue;
      }
      rec.photo = res.url;
      moved++;
      bytesFreed += before - res.url.length;
    }
    return { moved: moved, failed: failed, bytesFreed: bytesFreed };
  }

  window.JournalPhotos = {
    isDataUrl: isDataUrl,
    isRemoteUrl: isRemoteUrl,
    upload: upload,
    migrateRecords: migrateRecords,
    available: function () {
      return !!storage() && !!currentUid();
    },
  };
})();
