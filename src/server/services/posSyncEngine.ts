import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  idempotencyKeys,
  offlineSyncConflicts,
  products,
  salesOrderItems,
  salesOrders,
  salesPayments,
} from "@/server/db/schema";
import {
  calculateCartTotalsPure,
  type CartLineInput,
  type PaymentKind,
  type PromoInput,
} from "@/lib/posMath";
import { moneyString, toInt, toNumber } from "@/lib/format";
import { signReceipt } from "@/server/crypto";
import { applyStockMovement } from "@/server/services/inventoryEngine";
import { accrueCustomerSpend } from "@/server/services/customers";
import { mintReceiptNumber } from "@/server/services/salesEngine";
import { getTaxSettings } from "@/server/services/settings";
import { requireOpenShift } from "@/server/services/shiftEngine";
import { throwServiceError } from "@/server/services/errors";
import { writeAudit } from "@/server/rbac";
import { productPriceTiers } from "@/server/db/schema";

export type OfflineCartLine = {
  productId: string;
  qty: number;
  /** Prices the till actually charged, used for tamper detection. */
  appliedUnitPrice?: number;
};

export type SyncBatchItem = {
  clientRequestId: string;
  createdAt: string;
  cashierId: string;
  shiftId?: string | null;
  customerId?: string | null;
  memberDiscountPct?: number;
  manualDiscountAmount?: number;
  promo?: (PromoInput & { id?: string | null }) | null;
  paymentMethod: PaymentKind;
  cashReceived?: number;
  paymentReference?: string | null;
  payments?: { method: PaymentKind; amount: number; reference?: string | null }[];
  items: OfflineCartLine[];
  /** Totals the offline till computed; must match the server recomputation. */
  clientTotal?: number;
  receiptNumber?: string | null;
};

export type SyncItemResult = {
  clientRequestId: string;
  status: "SYNCED" | "ALREADY_SYNCED" | "REJECTED";
  orderId?: string;
  receiptNumber?: string;
  message?: string;
  conflicts?: { productId: string; serverQtyBefore: number; offlineQtySold: number }[];
  totalDelta?: number;
};

const MAX_TOTAL_DRIFT = 2; // Rp 2 tolerance for rounding on the till

type ProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  retailPrice: number;
  costPrice: number;
  isTaxable: boolean;
  isActive: boolean;
  stockOnHand: number;
};

async function loadProducts(productIds: string[]): Promise<Map<string, ProductSnapshot>> {
  const db = await getDb();
  const unique = Array.from(new Set(productIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id))));
  if (!unique.length) return new Map();
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      unit: products.unit,
      retailPrice: products.retailPrice,
      costPrice: products.costPrice,
      isTaxable: products.isTaxable,
      isActive: products.isActive,
      stockOnHand: products.stockOnHand,
    })
    .from(products)
    .where(inArray(products.id, unique));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        sku: row.sku,
        name: row.name,
        unit: row.unit,
        retailPrice: toNumber(row.retailPrice),
        costPrice: toNumber(row.costPrice),
        isTaxable: row.isTaxable,
        isActive: row.isActive,
        stockOnHand: row.stockOnHand,
      },
    ]),
  );
}

async function loadTiers(productIds: string[]) {
  const db = await getDb();
  const unique = Array.from(new Set(productIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id))));
  if (!unique.length) return new Map<string, { minQty: number; tierUnitPrice: number; label: string }[]>();
  const rows = await db
    .select({
      productId: productPriceTiers.productId,
      minQty: productPriceTiers.minQty,
      tierUnitPrice: productPriceTiers.tierUnitPrice,
      label: productPriceTiers.label,
    })
    .from(productPriceTiers)
    .where(inArray(productPriceTiers.productId, unique));
  const map = new Map<string, { minQty: number; tierUnitPrice: number; label: string }[]>();
  for (const row of rows) {
    const list = map.get(row.productId) ?? [];
    list.push({ minQty: row.minQty, tierUnitPrice: toNumber(row.tierUnitPrice), label: row.label });
    map.set(row.productId, list);
  }
  return map;
}

/**
 * Persists one sale. This is the only writer of sales_orders, so both the
 * online POS and the offline sync batch share identical validation, stock
 * movement, conflict logging and receipt signing.
 */
export async function persistSale(input: {
  item: SyncBatchItem;
  syncMode: "DIRECT_ONLINE" | "SYNCED_FROM_OFFLINE";
  actorId: string;
  allowNegativeStock: boolean;
}): Promise<SyncItemResult> {
  const db = await getDb();
  const clientRequestId = input.item.clientRequestId.trim();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(clientRequestId)) {
    return { clientRequestId, status: "REJECTED", message: "client_request_id tidak valid." };
  }

  // 1. Idempotency gate — a repeated batch must never double-deduct stock.
  const [existingOrder] = await db
    .select({ id: salesOrders.id, receiptNumber: salesOrders.receiptNumber })
    .from(salesOrders)
    .where(eq(salesOrders.clientRequestId, clientRequestId))
    .limit(1);
  if (existingOrder) {
    return {
      clientRequestId,
      status: "ALREADY_SYNCED",
      orderId: existingOrder.id,
      receiptNumber: existingOrder.receiptNumber,
      message: "Transaksi ini sudah pernah tersinkron.",
    };
  }

  const [existingKey] = await db
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, `sale:${clientRequestId}`))
    .limit(1);
  if (existingKey) {
    return { clientRequestId, status: "ALREADY_SYNCED", message: "Kunci idempoten sudah tercatat." };
  }

  if (!input.item.items.length) {
    return { clientRequestId, status: "REJECTED", message: "Keranjang kosong." };
  }

  // 2. Master-data reload — never trust prices that arrived from the device.
  const productIds = input.item.items.map((line) => line.productId);
  const productMap = await loadProducts(productIds);
  if (productMap.size !== new Set(productIds).size) {
    return {
      clientRequestId,
      status: "REJECTED",
      message: "Salah satu produk tidak ditemukan di master data server.",
    };
  }

  const goLiveShift = input.item.shiftId ? null : await requireOpenShift(input.actorId);
  const shiftId = input.item.shiftId ?? goLiveShift?.id ?? null;
  if (!shiftId) {
    return { clientRequestId, status: "REJECTED", message: "Tidak ada shift OPEN untuk transaksi ini." };
  }

  const tiersMap = await loadTiers(productIds);
  const cartLines: CartLineInput[] = [];
  for (const line of input.item.items) {
    const product = productMap.get(line.productId)!;
    if (!product.isActive) {
      return { clientRequestId, status: "REJECTED", message: `Produk ${product.name} sudah nonaktif.` };
    }
    cartLines.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      qty: Math.max(1, toInt(line.qty)),
      baseUnitPrice: product.retailPrice,
      costPrice: product.costPrice,
      isTaxable: product.isTaxable,
      tiers: tiersMap.get(product.id) ?? [],
    });
  }

  const tax = await getTaxSettings();
  const totals = calculateCartTotalsPure({
    lines: cartLines,
    memberDiscountPct: input.item.memberDiscountPct ?? 0,
    promo: input.item.promo ?? null,
    manualDiscountAmount: input.item.manualDiscountAmount ?? 0,
    paymentMethod: input.item.paymentMethod,
    tax,
  });

  if (totals.grandTotal <= 0) {
    return { clientRequestId, status: "REJECTED", message: "Total transaksi nol." };
  }

  const clientTotal = typeof input.item.clientTotal === "number" ? input.item.clientTotal : null;
  const totalDelta = clientTotal === null ? 0 : Math.abs(clientTotal - totals.grandTotal);
  if (clientTotal !== null && totalDelta > Math.max(MAX_TOTAL_DRIFT, Math.round(totals.grandTotal * 0.005))) {
    // Offline totals drift (e.g. stale price snapshot) is accepted but flagged.
    await writeAudit({
      actorId: input.actorId,
      action: "SALE_TOTAL_DRIFT",
      entityType: "sales_order",
      entityId: clientRequestId,
      severity: "WARNING",
      metadata: { clientTotal, serverTotal: totals.grandTotal, delta: totalDelta },
    });
  }

  // 3. Stock movement. Offline sales may drive stock negative — the cash and
  //    goods already moved, so the sale stands and a conflict row is raised.
  const conflicts: { productId: string; serverQtyBefore: number; offlineQtySold: number }[] = [];
  const receiptNumber = input.item.receiptNumber?.trim() || (await mintReceiptNumber());
  const createdAt = input.item.createdAt ? new Date(input.item.createdAt) : new Date();
  const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  for (const line of totals.lines) {
    const product = productMap.get(line.productId)!;
    const serverBefore = product.stockOnHand;
    await applyStockMovement({
      productId: line.productId,
      movementType: "POS_SALE",
      referenceId: receiptNumber,
      qtyChange: -line.qty,
      unitCost: line.unitCogs,
      actorId: input.actorId,
      notes: input.syncMode === "SYNCED_FROM_OFFLINE" ? "Penjualan tersinkron dari mode offline" : "Penjualan kasir",
      allowNegative: true,
    });
    product.stockOnHand = serverBefore - line.qty;
    if (serverBefore - line.qty < 0) {
      conflicts.push({ productId: line.productId, serverQtyBefore: serverBefore, offlineQtySold: line.qty });
    }
  }

  const [order] = await db
    .insert(salesOrders)
    .values({
      receiptNumber,
      clientRequestId,
      shiftId,
      cashierId: input.actorId,
      customerId: input.item.customerId ?? null,
      promoId: input.item.promo?.id ?? null,
      status: "COMPLETED",
      syncMode: input.syncMode,
      createdOfflineAt: input.syncMode === "SYNCED_FROM_OFFLINE" ? safeCreatedAt : null,
      syncedAt: input.syncMode === "SYNCED_FROM_OFFLINE" ? new Date() : null,
      subtotal: moneyString(totals.subtotal),
      tierDiscountTotal: moneyString(totals.tierDiscountTotal),
      memberDiscountAmount: moneyString(totals.memberDiscountAmount),
      promoDiscountAmount: moneyString(totals.promoDiscountAmount),
      manualDiscountAmount: moneyString(totals.manualDiscountAmount),
      taxAmount: moneyString(totals.taxAmount),
      roundingAdjustment: moneyString(totals.roundingAdjustment),
      grandTotal: moneyString(totals.grandTotal),
      totalCogs: moneyString(totals.totalCogs),
      paymentMethod: input.item.paymentMethod,
      cashReceived: moneyString(input.item.cashReceived ?? 0),
      changeGiven: moneyString(Math.max(0, toNumber(input.item.cashReceived) - totals.grandTotal)),
      paymentReference: input.item.paymentReference ?? null,
      createdAt: safeCreatedAt,
    })
    .returning();

  await db.insert(salesOrderItems).values(
    totals.lines.map((line) => ({
      orderId: order.id,
      productId: line.productId,
      productNameSnapshot: line.name,
      skuSnapshot: line.sku,
      qty: line.qty,
      baseUnitPrice: moneyString(line.baseUnitPrice),
      appliedUnitPrice: moneyString(line.appliedUnitPrice),
      tierLabelApplied: line.tierLabel,
      unitCogsSnapshot: moneyString(line.unitCogs),
      lineSubtotal: moneyString(line.lineSubtotal),
    })),
  );

  const payments = input.item.payments?.length
    ? input.item.payments
    : [{ method: input.item.paymentMethod, amount: totals.grandTotal, reference: input.item.paymentReference ?? null }];

  await db.insert(salesPayments).values(
    payments.map((payment) => ({
      orderId: order.id,
      method: payment.method,
      amount: moneyString(payment.amount),
      referenceNo: payment.reference ?? null,
    })),
  );

  for (const conflict of conflicts) {
    await db.insert(offlineSyncConflicts).values({
      orderId: order.id,
      productId: conflict.productId,
      clientRequestId,
      conflictType: "NEGATIVE_STOCK",
      serverQtyBefore: conflict.serverQtyBefore,
      offlineQtySold: conflict.offlineQtySold,
      resolved: false,
    });
  }

  if (input.item.customerId) {
    await accrueCustomerSpend(input.item.customerId, totals.grandTotal);
  }

  const signature = await signReceipt({
    orderId: order.id,
    receiptNumber,
    createdAt: order.createdAt.toISOString(),
    grandTotal: totals.grandTotal,
  });
  await db.update(salesOrders).set({ receiptSignature: signature }).where(eq(salesOrders.id, order.id));

  await db
    .insert(idempotencyKeys)
    .values({
      key: `sale:${clientRequestId}`,
      scope: "pos-sale",
      actorId: input.actorId,
      responsePayload: {
        orderId: order.id,
        receiptNumber,
        grandTotal: totals.grandTotal,
        conflicts: conflicts.length,
      },
    })
    .onConflictDoNothing();

  await writeAudit({
    actorId: input.actorId,
    action: input.syncMode === "SYNCED_FROM_OFFLINE" ? "SALE_SYNCED_FROM_OFFLINE" : "SALE_COMPLETED",
    entityType: "sales_order",
    entityId: order.id,
    severity: conflicts.length ? "WARNING" : "INFO",
    metadata: {
      receiptNumber,
      grandTotal: totals.grandTotal,
      paymentMethod: input.item.paymentMethod,
      conflicts: conflicts.length,
      clientTotal,
    },
  });

  return {
    clientRequestId,
    status: "SYNCED",
    orderId: order.id,
    receiptNumber,
    conflicts,
    totalDelta,
  };
}

/** Batch entry point — sequential, so a failure cannot roll back its siblings. */
export async function syncOfflineBatch(input: {
  actorId: string;
  items: SyncBatchItem[];
}): Promise<{ results: SyncItemResult[]; synced: number; alreadySynced: number; rejected: number }> {
  if (!input.items.length) return { results: [], synced: 0, alreadySynced: 0, rejected: 0 };
  if (input.items.length > 100) throwServiceError("Maksimal 100 transaksi per batch.", 400);

  const results: SyncItemResult[] = [];
  for (const item of input.items) {
    try {
      const result = await persistSale({
        item,
        syncMode: "SYNCED_FROM_OFFLINE",
        actorId: input.actorId,
        allowNegativeStock: true,
      });
      results.push(result);
    } catch (error) {
      results.push({
        clientRequestId: item.clientRequestId,
        status: "REJECTED",
        message: error instanceof Error ? error.message : "Gagal menyinkronkan transaksi.",
      });
    }
  }

  return {
    results,
    synced: results.filter((r) => r.status === "SYNCED").length,
    alreadySynced: results.filter((r) => r.status === "ALREADY_SYNCED").length,
    rejected: results.filter((r) => r.status === "REJECTED").length,
  };
}

export async function listSyncConflicts(options?: { includeResolved?: boolean; limit?: number }) {
  const db = await getDb();
  return db
    .select({
      id: offlineSyncConflicts.id,
      orderId: offlineSyncConflicts.orderId,
      productId: offlineSyncConflicts.productId,
      productName: products.name,
      sku: products.sku,
      clientRequestId: offlineSyncConflicts.clientRequestId,
      serverQtyBefore: offlineSyncConflicts.serverQtyBefore,
      offlineQtySold: offlineSyncConflicts.offlineQtySold,
      resolved: offlineSyncConflicts.resolved,
      resolutionNotes: offlineSyncConflicts.resolutionNotes,
      createdAt: offlineSyncConflicts.createdAt,
      receiptNumber: salesOrders.receiptNumber,
    })
    .from(offlineSyncConflicts)
    .leftJoin(products, eq(products.id, offlineSyncConflicts.productId))
    .leftJoin(salesOrders, eq(salesOrders.id, offlineSyncConflicts.orderId))
    .where(options?.includeResolved ? undefined : eq(offlineSyncConflicts.resolved, false))
    .orderBy(sql`${offlineSyncConflicts.createdAt} desc`)
    .limit(options?.limit ?? 50);
}

export async function resolveSyncConflict(input: {
  conflictId: string;
  managerId: string;
  notes: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(offlineSyncConflicts)
    .set({ resolved: true, resolvedBy: input.managerId, resolutionNotes: input.notes.trim() || null })
    .where(and(eq(offlineSyncConflicts.id, input.conflictId), eq(offlineSyncConflicts.resolved, false)));
  await writeAudit({
    actorId: input.managerId,
    action: "SYNC_CONFLICT_RESOLVED",
    entityType: "offline_sync_conflict",
    entityId: input.conflictId,
    metadata: { notes: input.notes },
  });
}
