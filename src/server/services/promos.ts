import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { promos, salesOrders } from "@/server/db/schema";
import { moneyString, toNumber } from "@/lib/format";
import type { PromoInput } from "@/lib/posMath";
import { throwServiceError } from "@/server/services/errors";

export type PromoRow = {
  id: string;
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minSubtotal: number;
  maxDiscountCap: number;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
};

function mapPromo(row: typeof promos.$inferSelect): PromoRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discountType: row.discountType,
    discountValue: toNumber(row.discountValue),
    minSubtotal: toNumber(row.minSubtotal),
    maxDiscountCap: toNumber(row.maxDiscountCap),
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    isActive: row.isActive,
  };
}

export async function listPromos(): Promise<PromoRow[]> {
  const db = await getDb();
  const rows = await db.select().from(promos).orderBy(asc(promos.code));
  return rows.map(mapPromo);
}

export async function listActivePromos(now = new Date()): Promise<PromoRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(promos)
    .where(and(eq(promos.isActive, true), lte(promos.validFrom, now), gte(promos.validUntil, now)))
    .orderBy(asc(promos.code));
  return rows.map(mapPromo);
}

export async function findPromoByCode(code: string, now = new Date()): Promise<PromoRow | null> {
  const value = code.trim().toUpperCase();
  if (!value) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(promos)
    .where(and(eq(sql`upper(${promos.code})`, value), eq(promos.isActive, true)))
    .limit(1);
  if (!row) return null;
  if (row.validFrom > now || row.validUntil < now) return null;
  return mapPromo(row);
}

export function toPromoInput(row: PromoRow): PromoInput {
  return {
    code: row.code,
    name: row.name,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minSubtotal: row.minSubtotal,
    maxDiscountCap: row.maxDiscountCap,
  };
}

/**
 * Promo applied to a *finalised* order. Capped by maxDiscountCap so a
 * percentage code cannot exceed the merchant's stated ceiling.
 */
export async function applyPromoToOrder(input: {
  orderId: string;
  promoCode: string;
}): Promise<{ promoId: string; discount: number }> {
  const db = await getDb();
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, input.orderId)).limit(1);
  if (!order) throwServiceError("Transaksi tidak ditemukan.", 404);
  if (order.status === "VOIDED") throwServiceError("Transaksi void tidak bisa diberi promo.", 409);

  const promo = await findPromoByCode(input.promoCode);
  if (!promo) throwServiceError("Kode promo tidak aktif atau tidak ditemukan.", 404);

  const subtotal = toNumber(order.subtotal);
  if (subtotal < promo.minSubtotal) {
    throwServiceError(
      `Promo ${promo.code} butuh belanja minimal Rp ${promo.minSubtotal.toLocaleString("id-ID")}.`,
      400,
    );
  }

  const raw = promo.discountType === "PERCENTAGE"
    ? Math.round((subtotal * promo.discountValue) / 100)
    : Math.round(promo.discountValue);
  const discount = promo.maxDiscountCap > 0 ? Math.min(raw, promo.maxDiscountCap) : raw;

  await db
    .update(salesOrders)
    .set({ promoId: promo.id, promoDiscountAmount: moneyString(discount) })
    .where(eq(salesOrders.id, input.orderId));

  return { promoId: promo.id, discount };
}

export async function createPromo(input: {
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minSubtotal: number;
  maxDiscountCap: number;
  validFrom: Date;
  validUntil: Date;
  isActive?: boolean;
}): Promise<PromoRow> {
  const db = await getDb();
  const code = input.code.trim().toUpperCase();
  if (!code) throwServiceError("Kode promo wajib diisi.", 400);
  if (input.discountValue <= 0) throwServiceError("Nilai diskon harus lebih besar dari nol.", 400);
  if (input.validUntil <= input.validFrom) throwServiceError("Tanggal berakhir harus setelah tanggal mulai.", 400);
  if (input.discountType === "PERCENTAGE" && input.discountValue > 100) {
    throwServiceError("Diskon persentase maksimal 100%.", 400);
  }

  const [row] = await db
    .insert(promos)
    .values({
      code,
      name: input.name.trim(),
      discountType: input.discountType,
      discountValue: moneyString(input.discountValue),
      minSubtotal: moneyString(input.minSubtotal),
      maxDiscountCap: moneyString(input.maxDiscountCap),
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      isActive: input.isActive ?? true,
    })
    .returning();
  return mapPromo(row);
}

export async function togglePromo(promoId: string, isActive: boolean): Promise<void> {
  const db = await getDb();
  await db.update(promos).set({ isActive }).where(eq(promos.id, promoId));
}
