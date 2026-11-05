/**
 * offlineDb.ts — type-safe IndexedDB wrapper for the offline till.
 *
 * Four stores, exactly as the spec requires:
 *   catalog_cache : products + tiers + members + promos + store settings
 *   held_bills    : parked carts that survive a tab crash
 *   tx_outbox     : finished sales awaiting sync (idempotent client ids)
 *   sync_history  : local audit trail of what this device pushed
 */

export const OFFLINE_DB_NAME = "katalis_pos_offline_v1";
export const OFFLINE_DB_VERSION = 1;

export type StoreName = "catalog_cache" | "held_bills" | "tx_outbox" | "sync_history";

export type CachedTier = { minQty: number; tierUnitPrice: number; label: string };

export type CachedProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  categoryName: string | null;
  retailPrice: number;
  costPrice: number;
  isTaxable: boolean;
  stockOnHand: number;
  tiers: CachedTier[];
};

export type CachedCustomer = {
  id: string;
  memberCode: string;
  name: string;
  tier: string;
  discountPct: number;
};

export type CachedPromo = {
  id: string;
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minSubtotal: number;
  maxDiscountCap: number;
};

export type CatalogSnapshot = {
  id: "current";
  fetchedAt: string;
  terminalId: string;
  products: CachedProduct[];
  customers: CachedCustomer[];
  promos: CachedPromo[];
  settings: {
    storeName: string;
    taxRatePct: number;
    priceIncludesTax: boolean;
    cashRoundingStep: number;
    cashierDiscountLimitPct: number;
  };
  shift: { id: string; shiftNumber: string; terminalId: string } | null;
};

export type OfflineLine = {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  baseUnitPrice: number;
  appliedUnitPrice: number;
  costPrice: number;
  isTaxable: boolean;
  tierLabel: string | null;
};

export type HeldBill = {
  id: string;
  label: string;
  createdAt: string;
  lines: OfflineLine[];
  customerId: string | null;
  customerName: string | null;
  note: string;
};

export type OutboxSale = {
  clientRequestId: string;
  createdAt: string;
  cashierId: string;
  shiftId: string | null;
  terminalId: string;
  receiptNumber: string | null;
  customerId: string | null;
  memberDiscountPct: number;
  manualDiscountAmount: number;
  promo: (CachedPromo & { code: string; name: string }) | null;
  paymentMethod: "CASH" | "QRIS" | "DEBIT_CARD" | "CREDIT_CARD" | "SPLIT_PAYMENT";
  cashReceived: number;
  changeGiven: number;
  paymentReference: string | null;
  payments: { method: "CASH" | "QRIS" | "DEBIT_CARD" | "CREDIT_CARD"; amount: number; reference?: string | null }[];
  items: { productId: string; sku: string; name: string; qty: number; appliedUnitPrice: number }[];
  clientTotal: number;
  grandTotal: number;
  taxAmount: number;
  tierDiscountTotal: number;
  attempts: number;
  lastError: string | null;
};

export type SyncHistoryEntry = {
  id: string;
  at: string;
  clientRequestId: string;
  status: "SYNCED" | "ALREADY_SYNCED" | "REJECTED";
  receiptNumber: string | null;
  message: string | null;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openOfflineDb(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error("IndexedDB hanya tersedia di browser."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("catalog_cache")) db.createObjectStore("catalog_cache", { keyPath: "id" });
      if (!db.objectStoreNames.contains("held_bills")) db.createObjectStore("held_bills", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tx_outbox")) db.createObjectStore("tx_outbox", { keyPath: "clientRequestId" });
      if (!db.objectStoreNames.contains("sync_history")) db.createObjectStore("sync_history", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Gagal membuka IndexedDB."));
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openOfflineDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        const request = run(objectStore);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${store} gagal.`));
      }),
  );
}

export const offlineDb = {
  async getCatalog(): Promise<CatalogSnapshot | null> {
    if (!isBrowser()) return null;
    try {
      return (await tx<CatalogSnapshot | undefined>("catalog_cache", "readonly", (store) => store.get("current"))) ?? null;
    } catch {
      return null;
    }
  },

  async saveCatalog(snapshot: CatalogSnapshot): Promise<void> {
    await tx("catalog_cache", "readwrite", (store) => store.put(snapshot));
  },

  async listHeldBills(): Promise<HeldBill[]> {
    if (!isBrowser()) return [];
    try {
      const rows = await tx<HeldBill[]>("held_bills", "readonly", (store) => store.getAll());
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } catch {
      return [];
    }
  },

  async saveHeldBill(bill: HeldBill): Promise<void> {
    await tx("held_bills", "readwrite", (store) => store.put(bill));
  },

  async removeHeldBill(id: string): Promise<void> {
    await tx("held_bills", "readwrite", (store) => store.delete(id));
  },

  async listOutbox(): Promise<OutboxSale[]> {
    if (!isBrowser()) return [];
    try {
      const rows = await tx<OutboxSale[]>("tx_outbox", "readonly", (store) => store.getAll());
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    } catch {
      return [];
    }
  },

  async countOutbox(): Promise<number> {
    if (!isBrowser()) return 0;
    try {
      return await tx<number>("tx_outbox", "readonly", (store) => store.count());
    } catch {
      return 0;
    }
  },

  async enqueueSale(sale: OutboxSale): Promise<void> {
    await tx("tx_outbox", "readwrite", (store) => store.put(sale));
  },

  async markSaleAttempt(clientRequestId: string, error: string): Promise<void> {
    const existing = await tx<OutboxSale | undefined>("tx_outbox", "readonly", (store) => store.get(clientRequestId));
    if (!existing) return;
    const next: OutboxSale = { ...existing, attempts: existing.attempts + 1, lastError: error };
    await tx("tx_outbox", "readwrite", (store) => store.put(next));
  },

  async clearOutboxEntry(clientRequestId: string): Promise<void> {
    await tx("tx_outbox", "readwrite", (store) => store.delete(clientRequestId));
  },

  async listSyncHistory(): Promise<SyncHistoryEntry[]> {
    if (!isBrowser()) return [];
    try {
      const rows = await tx<SyncHistoryEntry[]>("sync_history", "readonly", (store) => store.getAll());
      return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100);
    } catch {
      return [];
    }
  },

  async recordSyncHistory(entry: SyncHistoryEntry): Promise<void> {
    await tx("sync_history", "readwrite", (store) => store.put(entry));
  },

  async resetAll(): Promise<void> {
    if (!isBrowser()) return;
    await Promise.all([
      tx("catalog_cache", "readwrite", (store) => store.clear()),
      tx("held_bills", "readwrite", (store) => store.clear()),
      tx("tx_outbox", "readwrite", (store) => store.clear()),
      tx("sync_history", "readwrite", (store) => store.clear()),
    ]);
  },
};

export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `crid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function findCachedProduct(snapshot: CatalogSnapshot | null, query: string): CachedProduct | null {
  if (!snapshot) return null;
  const term = query.trim().toLowerCase();
  if (!term) return null;
  return (
    snapshot.products.find((product) => product.barcode && product.barcode.toLowerCase() === term) ??
    snapshot.products.find((product) => product.sku.toLowerCase() === term) ??
    null
  );
}

export function searchCachedProducts(snapshot: CatalogSnapshot | null, query: string, limit = 8): CachedProduct[] {
  if (!snapshot) return [];
  const term = query.trim().toLowerCase();
  if (!term) return snapshot.products.slice(0, limit);
  return snapshot.products
    .filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        (product.barcode ?? "").includes(term),
    )
    .slice(0, limit);
}
