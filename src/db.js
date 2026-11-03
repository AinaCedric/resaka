// Stockage local (IndexedDB) : réunions + morceaux audio
const DB_NAME = 'resaka';
const DB_VERSION = 1;
let dbp = null;
const locks = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meetings')) db.createObjectStore('meetings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  listMeetings: async () => {
    const all = (await tx('meetings', 'readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  getMeeting: (id) => tx('meetings', 'readonly', (s) => s.get(id)),
  putMeeting: (m) => { m.updatedAt = Date.now(); return tx('meetings', 'readwrite', (s) => s.put(m)); },
  deleteMeeting: async (m) => {
    for (const c of m.chunks || []) await tx('audio', 'readwrite', (s) => s.delete(`${m.id}:${c.idx}`));
    await tx('meetings', 'readwrite', (s) => s.delete(m.id));
  },
  // Mise à jour atomique (sérialisée par réunion) pour éviter les écrasements concurrents
  update: (id, fn) => {
    const prev = locks.get(id) || Promise.resolve();
    const p = prev.catch(() => {}).then(async () => {
      const m = await db.getMeeting(id);
      if (!m) return null;
      const r = await fn(m);
      if (r === false) return m;
      await db.putMeeting(m);
      return m;
    });
    locks.set(id, p);
    return p;
  },
  putAudio:(meetingId, idx, blob) => tx('audio', 'readwrite', (s) => s.put(blob, `${meetingId}:${idx}`)),
  getAudio: (meetingId, idx) => tx('audio', 'readonly', (s) => s.get(`${meetingId}:${idx}`)),
};

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
