import { catalogueSchema, type PlanNetwork } from "./model";

export interface StoredCatalogue {
  account: string;
  token: string;
  revision: number;
  dirty: boolean;
  networks: PlanNetwork[];
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gtnh-plan-networks", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("catalogues", { keyPath: "account" });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Reload other planner tabs to open your networks."));
  });
}

export async function readCatalogue(account: string): Promise<StoredCatalogue | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("catalogues").objectStore("catalogues").get(account);
      request.onsuccess = () => {
        try {
          const value = request.result as StoredCatalogue | undefined;
          if (value) catalogueSchema.parse(value.networks);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** A transaction guards browser-tab writes just as the server revision guards device writes. */
export async function writeCatalogue(
  value: StoredCatalogue,
  expectedToken?: string,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("catalogues", "readwrite");
      const store = transaction.objectStore("catalogues");
      const request = store.get(value.account);
      let conflict = false;
      request.onsuccess = () => {
        const current = request.result as StoredCatalogue | undefined;
        if (current?.token !== expectedToken) {
          conflict = true;
          transaction.abort();
          return;
        }
        store.put(value);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          new Error(
            conflict
              ? "Your networks changed in another tab. Reload networks before editing."
              : "Your networks could not be saved.",
          ),
        );
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
