import {
  decode,
  Recording,
  RecordingMeta,
  sanitizeImported,
  upgradeV1,
} from './format';

const DB_NAME = 'ftc-dashboard';
const DB_VERSION = 1;
const STORE_RECORDINGS = 'recordings';
const STORE_META = 'meta';

/** Prefix written by the pre-v2 recorder. Those entries are read, never rewritten. */
export const LEGACY_PREFIX = 'field_replay_';

/** Unpinned auto-captures kept before the oldest is evicted. */
export const AUTO_KEEP_COUNT = 10;

export type RecordingSource = 'idb' | 'legacy';

export type RecordingListEntry = {
  meta: RecordingMeta;
  source: RecordingSource;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let idbBroken = false;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function isIndexedDbAvailable(): boolean {
  return hasIndexedDb() && !idbBroken;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
        db.createObjectStore(STORE_RECORDINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Another tab wanting a newer schema blocks forever on a connection that
      // never closes, taking that tab's recorder down with it. Standing aside
      // costs this tab a reconnect, which the next call does automatically.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    // Private browsing in some engines resolves neither handler.
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });

  dbPromise = dbPromise.catch((err) => {
    idbBroken = true;
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

function tx<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (stores: IDBObjectStore[]) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        const stores = storeNames.map((n) => transaction.objectStore(n));

        let request: IDBRequest<T> | null = null;
        try {
          request = run(stores);
        } catch (err) {
          reject(err);
          return;
        }

        transaction.oncomplete = () =>
          resolve(request ? (request.result as T) : null);
        transaction.onerror = () =>
          reject(
            transaction.error ?? new Error('IndexedDB transaction failed'),
          );
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('IndexedDB transaction aborted'),
          );
      }),
  );
}

function legacyKeys(): string[] {
  try {
    return Object.keys(window.localStorage).filter((k) =>
      k.startsWith(LEGACY_PREFIX),
    );
  } catch {
    return [];
  }
}

function legacyMeta(key: string): RecordingMeta {
  let bytes = 0;
  try {
    bytes = window.localStorage.getItem(key)?.length ?? 0;
  } catch {
    bytes = 0;
  }

  return {
    id: key,
    name: key.replace(LEGACY_PREFIX, ''),
    opMode: '',
    createdAt: 0,
    robotT0: 0,
    durationMs: 0,
    frameCount: 0,
    bytes,
    channels: { telemetry: false, field: true },
    origin: 'recorded',
    pinned: true,
  };
}

export function isLegacyId(id: string): boolean {
  return id.startsWith(LEGACY_PREFIX);
}

export async function list(): Promise<RecordingListEntry[]> {
  // A previous failure marked the store broken and dropped the cached handle.
  // Clear the flag so this call gets to try again; if it fails, it sets it back.
  if (idbBroken && dbPromise === null && hasIndexedDb()) idbBroken = false;

  const legacy: RecordingListEntry[] = legacyKeys().map((k) => ({
    meta: legacyMeta(k),
    source: 'legacy' as const,
  }));

  let stored: RecordingListEntry[] = [];
  if (isIndexedDbAvailable()) {
    try {
      const metas = await tx<RecordingMeta[]>([STORE_META], 'readonly', ([s]) =>
        s.getAll(),
      );
      stored = (metas ?? []).map((meta) => ({ meta, source: 'idb' as const }));
    } catch {
      // A read that fails is not an empty library. The usual cause is a
      // connection the browser closed under us, which every later call inherits
      // because dbPromise caches the dead handle; dropping it lets the next one
      // reconnect without a reload.
      dbPromise = null;
      idbBroken = true;
      stored = [];
    }
  }

  return [...stored, ...legacy].sort(
    (a, b) => b.meta.createdAt - a.meta.createdAt,
  );
}

export async function load(id: string): Promise<Recording | null> {
  if (isLegacyId(id)) {
    try {
      const raw = window.localStorage.getItem(id);
      if (!raw) return null;
      const upgraded = upgradeV1(
        JSON.parse(raw),
        id,
        id.replace(LEGACY_PREFIX, ''),
      );
      // Sanitized on the way out, exactly as importFile does with the very same
      // structure. These rows were written by an older dashboard that bounded
      // none of this, so without it a legacy entry is the one route by which an
      // unbounded point array or an off-origin image path reaches the canvas.
      return upgraded ? sanitizeImported(upgraded) : null;
    } catch {
      return null;
    }
  }

  if (!isIndexedDbAvailable()) return null;

  try {
    const rec = await tx<Recording>([STORE_RECORDINGS], 'readonly', ([s]) =>
      s.get(id),
    );
    return rec ? decode(rec) : null;
  } catch {
    return null;
  }
}

/** Just the metadata, so a flush can merge user edits without decoding frames. */
/**
 * Throws rather than reporting a read failure as absence.
 *
 * Its caller treats a missing row as proof the user deleted the recording
 * mid-run and stops the live session on it, so a transient read error folded
 * into the same `null` would silently end a match in progress.
 */
export async function loadMeta(id: string): Promise<RecordingMeta | null> {
  if (isLegacyId(id) || !isIndexedDbAvailable()) return null;

  const meta = await tx<RecordingMeta>([STORE_META], 'readonly', ([s]) =>
    s.get(id),
  );
  return meta ?? null;
}

export async function save(rec: Recording): Promise<void> {
  if (!isIndexedDbAvailable()) throw new Error('IndexedDB unavailable');

  await tx([STORE_RECORDINGS, STORE_META], 'readwrite', ([recs, metas]) => {
    recs.put(rec);
    metas.put(rec.meta);
    return null;
  });
}

export async function remove(id: string): Promise<void> {
  if (isLegacyId(id)) {
    try {
      window.localStorage.removeItem(id);
    } catch {
      // Nothing useful to do; the caller re-lists either way.
    }
    return;
  }

  if (!isIndexedDbAvailable()) return;

  await tx([STORE_RECORDINGS, STORE_META], 'readwrite', ([recs, metas]) => {
    recs.delete(id);
    metas.delete(id);
    return null;
  });
}

export async function updateMeta(
  id: string,
  patch: Partial<RecordingMeta>,
): Promise<void> {
  if (isLegacyId(id) || !isIndexedDbAvailable()) return;

  // One transaction, not load()-then-save(): the recorder's flush can land
  // between those awaits, and the save then writes back the older snapshot,
  // truncating a run being renamed while it records. IndexedDB serialises
  // overlapping readwrite transactions on the same stores.
  await tx([STORE_RECORDINGS, STORE_META], 'readwrite', ([recs, metas]) => {
    const get = recs.get(id);
    get.onsuccess = () => {
      const rec = get.result as Recording | undefined;
      if (!rec) return;

      const meta = { ...rec.meta, ...patch };
      recs.put({ ...rec, meta });
      metas.put(meta);
    };
    return null;
  });
}

/**
 * Drops the oldest unpinned auto-captures. Pinned recordings, legacy entries and
 * anything currently loaded are never touched.
 */
export async function evictAuto(
  keep = AUTO_KEEP_COUNT,
  protectedId?: string | null,
): Promise<string[]> {
  if (!isIndexedDbAvailable()) return [];

  const entries = await list();
  const auto = entries
    .filter(
      (e) => e.source === 'idb' && !e.meta.pinned && e.meta.id !== protectedId,
    )
    .sort((a, b) => b.meta.createdAt - a.meta.createdAt);

  const doomed = auto.slice(keep);
  for (const e of doomed) {
    await remove(e.meta.id);
  }

  return doomed.map((e) => e.meta.id);
}

export async function usage(): Promise<{ usage: number; quota: number }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportFile(id: string): Promise<void> {
  if (isLegacyId(id)) {
    // Legacy files download byte-identically to how they were saved.
    const raw = window.localStorage.getItem(id);
    if (raw) download(`${id}.json`, raw);
    return;
  }

  const rec = await load(id);
  if (!rec) return;

  // Download first. Pinning is a nicety, but it is also the one write that can
  // reject at quota, which is exactly when a user is trying to export in order to
  // free space. Gating the download behind it made the button look broken.
  download(`${rec.meta.name || id}.json`, JSON.stringify(rec));
  try {
    await updateMeta(id, { pinned: true });
  } catch {
    // Exported is what matters; the pin is best effort.
  }
}

export async function importFile(file: File): Promise<Recording> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  const baseName = file.name.replace(/\.json$/i, '');
  const id = newRecordingId();

  // v1 files are a bare array of {timestamp, ops}.
  if (Array.isArray(parsed)) {
    const upgraded = upgradeV1(parsed, id, baseName);
    if (!upgraded) throw new Error('Not a recognizable recording');

    const rec = sanitizeImported(upgraded);
    await save(rec);
    return rec;
  }

  const decoded = decode(parsed);
  if (!decoded) throw new Error('Not a recognizable recording');

  const rec = sanitizeImported({
    ...decoded,
    id,
    meta: {
      ...decoded.meta,
      id,
      name: decoded.meta.name || baseName,
      pinned: true,
    },
  });

  await save(rec);
  return rec;
}

let idCounter = 0;

/**
 * Distinguishes this tab from any other sharing the database.
 *
 * The counter is per-tab module state, so two dashboards on one robot both
 * begin at 1 and arm off the same status poll, landing in the same millisecond
 * with the same id.
 */
const tabId = Math.random().toString(36).slice(2, 8);

export function newRecordingId(): string {
  idCounter += 1;
  // Second-granularity date keys made two saves in the same second overwrite
  // each other, so the counter is load-bearing rather than decorative.
  return `rec_${Date.now()}_${tabId}_${idCounter}`;
}
