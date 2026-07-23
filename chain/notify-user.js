/*
 * Write an in-app notification into users/{uid}/notifications (Admin SDK).
 */
export async function notifyUser(db, uid, payload) {
  if (!db || !uid || !payload) return null;
  const doc = {
    uid: String(uid),
    type: String(payload.type || 'system'),
    title: String(payload.title || 'Update').slice(0, 120),
    body: String(payload.body || '').slice(0, 400),
    createdAt: new Date().toISOString(),
    read: false,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    source: payload.source || 'queue',
  };
  if (payload.action && typeof payload.action === 'object') {
    doc.action = {
      view: String(payload.action.view || ''),
      plantId: payload.action.plantId || null,
      listingId: payload.action.listingId || null,
    };
  }
  const ref = await db.collection('users').doc(uid).collection('notifications').add(doc);
  return ref.id;
}
