const DB_NAME = 'live-resource-inspector';
const DB_VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('resources')) {
        const store = db.createObjectStore('resources', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('bySessionRev', ['sessionId', 'rev'], { unique: false });
      }
      if (!db.objectStoreNames.contains('requests')) {
        const store = db.createObjectStore('requests', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('bySessionRev', ['sessionId', 'rev'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('IndexedDB недоступна'));
    };
  });
  return opening;
}

async function transact(storeNames: string | string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    run(tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Операция IndexedDB прервана'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка чтения IndexedDB'));
  });
}

export async function putRecords(storeName: 'resources' | 'requests' | 'sessions', records: unknown[]): Promise<void> {
  if (records.length === 0) return;
  const chunkSize = 1000;
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    await transact(storeName, 'readwrite', (tx) => {
      const store = tx.objectStore(storeName);
      for (const record of chunk) store.put(record);
    });
  }
}

export async function deleteIds(storeName: 'resources' | 'requests', ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await transact(storeName, 'readwrite', (tx) => {
    const store = tx.objectStore(storeName);
    for (const id of ids) store.delete(id);
  });
}

export async function deleteSessionRecords(sessionId: string): Promise<void> {
  for (const storeName of ['resources', 'requests'] as const) {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Не удалось очистить сессию'));
      tx.onabort = () => reject(tx.error ?? new Error('Очистка сессии прервана'));
    });
  }
}

export async function getAllBySession<T>(storeName: 'resources' | 'requests', sessionId: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).index('sessionId').getAll(sessionId));
}

export async function getSince<T>(storeName: 'resources' | 'requests', sessionId: string, afterRev: number): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const range = IDBKeyRange.bound([sessionId, afterRev], [sessionId, Number.MAX_SAFE_INTEGER], true, false);
  return requestResult(tx.objectStore(storeName).index('bySessionRev').getAll(range));
}

export async function putSession(session: unknown): Promise<void> {
  await putRecords('sessions', [session]);
}

export async function getSession<T>(id: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction('sessions', 'readonly');
  return requestResult(tx.objectStore('sessions').get(id));
}

export async function listSessions<T>(): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction('sessions', 'readonly');
  const sessions = await requestResult<T[]>(tx.objectStore('sessions').getAll());
  return sessions.sort((left, right) => {
    const a = left as { updatedAt?: number };
    const b = right as { updatedAt?: number };
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}
