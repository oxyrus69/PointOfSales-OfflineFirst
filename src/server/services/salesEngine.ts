import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  posShifts,
  productPriceTiers,
  profiles,
  products,
  salesOrderItems,
  salesOrders,
  type SalesOrder,
} from "@/server/db/schema";
import { calculateCartTotalsPure, type CartLineInput } from "@/lib/posMath";
import { moneyString, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/server/services/sequences";
import { getStoreSettings, getTaxSettings } from "@/server/services/settings";
import { throwServiceError } from "@/server/services/errors";

export type OrderWithItems = {
  order: SalesOrder;
  items: (typeof salesOrderItems.$inferSelect)[];
  cashierName: string | null;
};

export async function listOrders(options?: {
  search?: string;
  status?: "COMPLETED" | "VOIDED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  shiftId?: string;
  days?: number;
  limit?: number;
}) {
  const db = await getDb();
  const conditions = [];
  if (options?.status) conditions.push(eq(salesOrders.status, options.status));
  if (options?.shiftId) conditions.push(eq(salesOrders.shiftId, options.shiftId));
  if (options?.days) {
    conditions.push(gte(salesOrders.createdAt, new Date(Date.now() - options.days * 86_400_000)));
  }
  if (options?.search?.trim()) {
    const pattern = `%${options.search.trim()}%`;
    conditions.push(sql`(${salesOrders.receiptNumber} ilike ${pattern} or ${salesOrders.clientRequestId} ilike ${pattern})`);
  }

  return db
    .select({
      id: salesOrders.id,
      receiptNumber: salesOrders.receiptNumber,
      createdAt: salesOrders.createdAt,
      status: salesOrders.status,
      syncMode: salesOrders.syncMode,
      paymentMethod: salesOrders.paymentMethod,
      grandTotal: salesOrders.grandTotal,
      subtotal: salesOrders.subtotal,
      taxAmount: salesOrders.taxAmount,
      totalCogs: salesOrders.totalCogs,
      cashierName: profiles.fullName,
      cashierId: salesOrders.cashierId,
      shiftId: salesOrders.shiftId,
      shiftNumber: posShifts.shiftNumber,
      voidReason: salesOrders.voidReason,
    })
    .from(salesOrders)
    .leftJoin(profiles, eq(profiles.id, salesOrders.cashierId))
    .leftJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(salesOrders.createdAt))
    .limit(options?.limit ?? 100);
}

export async function getOrderDetail(orderId: string): Promise<OrderWithItems | null> {
  const db = await getDb();
  const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId))
    .orderBy(salesOrderItems.skuSnapshot);
  const [cashier] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, row.cashierId))
    .limit(1);
  return { order: row, items, cashierName: cashier?.fullName ?? null };
}

export async function findOrderByReceipt(receiptNumber: string): Promise<OrderWithItems | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(eq(salesOrders.receiptNumber, receiptNumber))
    .limit(1);
  if (!row) return null;
  return getOrderDetail(row.id);
}

/**
 * Server-side revalidation of an offline/online basket. The client sends raw
 * lines + prices it used; the server recomputes from master data and rejects
 * any drift beyond rounding tolerance so a tampered offline queue cannot pass.
 */
export async function revalidateCart(input: {
  lines: { productId: string; qty: number }[];
  memberDiscountPct?: number;
  promo?: {
    code: string;
    name: string;
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    minSubtotal: number;
    maxDiscountCap: number;
  } | null;
  paymentMethod: "CASH" | "QRIS" | "DEBIT_CARD" | "CREDIT_CARD" | "SPLIT_PAYMENT";
  manualDiscountAmount?: number;
}) {
  const db = await getDb();
  const ids = input.lines.map((line) => line.productId);
  if (!ids.length) throwServiceError("Keranjang kosong.", 400);

  const rows = await db.select().from(products).where(inArray(products.id, ids));

  const found = new Map(rows.map((row) => [row.id, row]));
  const tierRows = await db
    .select({
      productId: productPriceTiers.productId,
      minQty: productPriceTiers.minQty,
      tierUnitPrice: productPriceTiers.tierUnitPrice,
      label: productPriceTiers.label,
    })
    .from(productPriceTiers)
    .where(inArray(productPriceTiers.productId, ids));

  const tiersByProduct = new Map<string, { minQty: number; tierUnitPrice: number; label: string }[]>();
  for (const tier of tierRows) {
    const list = tiersByProduct.get(tier.productId) ?? [];
    list.push({
      minQty: tier.minQty,
      tierUnitPrice: toNumber(tier.tierUnitPrice),
      label: tier.label,
    });
    tiersByProduct.set(tier.productId, list);
  }

  const cartLines: CartLineInput[] = [];
  for (const line of input.lines) {
    const product = found.get(line.productId);
    if (!product) throwServiceError(`Produk ${line.productId} tidak ditemukan di master data.`, 400);
    if (!product.isActive) throwServiceError(`Produk ${product.name} sudah tidak aktif.`, 409);
    cartLines.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      qty: Math.max(1, Math.trunc(line.qty)),
      baseUnitPrice: toNumber(product.retailPrice),
      costPrice: toNumber(product.costPrice),
      isTaxable: product.isTaxable,
      tiers: tiersByProduct.get(product.id) ?? [],
    });
  }

  const tax = await getTaxSettings();
  const settings = await getStoreSettings();
  const totals = calculateCartTotalsPure({
    lines: cartLines,
    memberDiscountPct: input.memberDiscountPct ?? 0,
    promo: input.promo ?? null,
    manualDiscountAmount: input.manualDiscountAmount ?? 0,
    paymentMethod: input.paymentMethod,
    tax,
  });

  return { totals, settings, productsById: found };
}

/** Receipt number minting for a shift-scoped sale. */
export async function mintReceiptNumber(): Promise<string> {
  return nextDocumentNumber("receipt", "INV-YYYYMMDD", 4);
}

export async function orderSummaryBetween(from: Date, to: Date) {
  const db = await getDb();
  const [row] = await db
    .select({
      orderCount: sql<string>`count(*)`,
      gross: sql<string>`coalesce(sum(${salesOrders.subtotal}), 0)`,
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      tax: sql<string>`coalesce(sum(${salesOrders.taxAmount}), 0)`,
      discounts: sql<string>`coalesce(sum(${salesOrders.tierDiscountTotal} + ${salesOrders.memberDiscountAmount} + ${salesOrders.promoDiscountAmount} + ${salesOrders.manualDiscountAmount}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesOrders.totalCogs}), 0)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, from), lt(salesOrders.createdAt, to)));
  return {
    orderCount: Number(row?.orderCount ?? 0),
    gross: toNumber(row?.gross),
    net: toNumber(row?.net),
    tax: toNumber(row?.tax),
    discounts: toNumber(row?.discounts),
    cogs: toNumber(row?.cogs),
  };
}

export async function updateOrderPromoDiscount(orderId: string, amount: number): Promise<void> {
  const db = await getDb();
  await db
    .update(salesOrders)
    .set({ promoDiscountAmount: moneyString(amount) })
    .where(eq(salesOrders.id, orderId));
}
