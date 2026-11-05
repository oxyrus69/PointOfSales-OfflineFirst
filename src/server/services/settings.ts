import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from "@/lib/posMath";
import { toNumber } from "@/lib/format";

export type StoreSettings = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  taxRatePct: number;
  priceIncludesTax: boolean;
  cashRoundingStep: number;
  cashierDiscountLimitPct: number;
  cashOutPinThreshold: number;
  supervisorVoidEnabled: boolean;
  varianceToleranceIdr: number;
  leadTimeDays: number;
};

export const DEFAULT_SETTINGS: StoreSettings = {
  storeName: "Katalis Mart",
  storeAddress: "Jl. Merdeka No. 88, Bandung",
  storePhone: "0812-0000-8899",
  taxRatePct: DEFAULT_TAX_SETTINGS.taxRatePct,
  priceIncludesTax: DEFAULT_TAX_SETTINGS.priceIncludesTax,
  cashRoundingStep: DEFAULT_TAX_SETTINGS.cashRoundingStep,
  cashierDiscountLimitPct: 5,
  cashOutPinThreshold: 100000,
  supervisorVoidEnabled: true,
  varianceToleranceIdr: 5000,
  leadTimeDays: 5,
};

const SETTING_LABELS: Record<keyof StoreSettings, string> = {
  storeName: "Nama Toko",
  storeAddress: "Alamat Toko",
  storePhone: "Telepon Toko",
  taxRatePct: "Tarif PPN (%)",
  priceIncludesTax: "Harga sudah termasuk pajak",
  cashRoundingStep: "Pembulatan tunai (Rp)",
  cashierDiscountLimitPct: "Batas diskon manual kasir (%)",
  cashOutPinThreshold: "Ambang PIN kas keluar (Rp)",
  supervisorVoidEnabled: "Wajib PIN Supervisor untuk void",
  varianceToleranceIdr: "Toleransi selisih kas (Rp)",
  leadTimeDays: "Lead time supplier (hari)",
};

function parseSetting(key: keyof StoreSettings, raw: string): string | number | boolean {
  if (key === "priceIncludesTax" || key === "supervisorVoidEnabled") return raw === "true";
  const numericKeys: (keyof StoreSettings)[] = [
    "taxRatePct",
    "cashRoundingStep",
    "cashierDiscountLimitPct",
    "cashOutPinThreshold",
    "varianceToleranceIdr",
    "leadTimeDays",
  ];
  if (numericKeys.includes(key)) return toNumber(raw, DEFAULT_SETTINGS[key] as number);
  return raw;
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const db = await getDb();
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof StoreSettings)[];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const merged: StoreSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = row.key as keyof StoreSettings;
    if (!(key in merged)) continue;
    (merged as unknown as Record<string, unknown>)[key] = parseSetting(key, row.value);
  }
  if (merged.storeName === "Katalis Mart" && process.env.STORE_NAME) merged.storeName = process.env.STORE_NAME;
  return merged;
}

export async function getTaxSettings(): Promise<TaxSettings> {
  const settings = await getStoreSettings();
  return {
    taxRatePct: settings.taxRatePct,
    priceIncludesTax: settings.priceIncludesTax,
    cashRoundingStep: settings.cashRoundingStep,
  };
}

export async function updateStoreSettings(
  patch: Partial<StoreSettings>,
  updatedBy: string,
): Promise<StoreSettings> {
  const db = await getDb();
  const entries = Object.entries(patch) as [keyof StoreSettings, string | number | boolean][];
  for (const [key, value] of entries) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const stringValue = typeof value === "boolean" ? String(value) : String(value);
    await db
      .insert(appSettings)
      .values({
        key,
        value: stringValue,
        group: "store",
        label: SETTING_LABELS[key],
        updatedBy,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: stringValue, updatedAt: new Date(), updatedBy },
      });
  }
  return getStoreSettings();
}

export async function listAllSettings() {
  const db = await getDb();
  return db.select().from(appSettings).orderBy(appSettings.group, appSettings.key);
}

export async function getSettingValue(key: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? null;
}
