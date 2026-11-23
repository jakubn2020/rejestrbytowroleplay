import type { Storage } from "./examiners-types";

/** Do testów lokalnych. Dane znikają po restarcie serwera. */
export function memoryStorage(): Storage {
  const m = new Map<string, unknown>();
  return {
    async get<T>(key: string, fallback: T) {
      return (m.has(key) ? (m.get(key) as T) : fallback);
    },
    async set<T>(key: string, value: T) {
      m.set(key, value);
    },
  };
}

/**
 * Netlify Blobs (trwałe, działa na Netlify). Wymaga: npm i @netlify/blobs
 * Użycie: const storage = await netlifyBlobsStorage("examiners");
 */
export async function netlifyBlobsStorage(name: string): Promise<Storage> {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore(name);
  return {
    async get<T>(key: string, fallback: T) {
      const v = await store.get(key, { type: "json" });
      return (v ?? fallback) as T;
    },
    async set<T>(key: string, value: T) {
      await store.setJSON(key, value);
    },
  };
}
