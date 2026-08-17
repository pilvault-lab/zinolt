/**
 * Tiny IndexedDB blob store for session frames.
 *
 * Uploaded/pasted/dropped files are stored here by frame id so they survive
 * a page reload (the blob-URL alone would die). On load, `HypeEditStudio`
 * rehydrates each session frame by fetching its blob and creating a fresh
 * ObjectURL.
 */

const DB_NAME = "hype-edit";
const DB_VERSION = 1;
const STORE = "frame-blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await withStore("readwrite", (s) => s.put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | null> {
  try {
    const value = await withStore<Blob | undefined>("readonly", (s) =>
      s.get(id) as IDBRequest<Blob | undefined>,
    );
    return value ?? null;
  } catch {
    return null;
  }
}

export async function deleteBlob(id: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch {
    /* swallow — nothing to do */
  }
}

/** Delete any blobs whose id isn't in `keepIds` (garbage collect on save). */
export async function gcBlobs(keepIds: Set<string>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const id = String(cursor.key);
        if (!keepIds.has(id)) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* swallow */
  }
}
