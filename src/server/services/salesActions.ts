import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  posShifts,
  products,
  returnsRefunds,
  salesOrderItems,
  salesOrders,
  salesPayments,
} from "@/server/db/schema";
import { rupiah } from "@/lib/posMath";
import { moneyString, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/server/services/sequences";
import { persistSale, type SyncBatchItem } from "@/server/services/posSyncEngine";
import { revalidateCart } from "@/server/services/salesEngine";
import { getStoreSettings } from "@/server/services/settings";
import { throwServiceError } from "@/server/services/errors";
import { verifySupervisorPin } from "@/server/services/supervisorAuth";
import { writeAudit } from "@/server/rbac";
import { applyStockMovement } from "@/server/services/inventoryEngine";

export type CompleteSaleInput = SyncBatchItem & {
  /** Cashier PIN is only required when the manual discount exceeds the limit. */
  supervisorPin?: string | null;
};

/**
 * Online checkout. Same persistSale path as offline sync, plus the cashier
 * discount ceiling check that needs a supervisor PIN when exceeded.
 */
export async function completeSale(input: {
  actorId: string;
  sale: CompleteSaleInput;
}) {
  const settings = await getStoreSettings();
  const manualDiscount = rupiah(input.sale.manualDiscountAmount ?? 0);

  let authorizedBy: string | null = null;

  if (manualDiscount > 0) {
    // Compare the manual discount against the cashier ceiling measured on the
    // pre-discount subtotal, exactly as the till displays it.
    const preview = await revalidateCart({
      lines: input.sale.items.map((line) => ({ productId: line.productId, qty: line.qty })),
      memberDiscountPct: input.sale.memberDiscountPct ?? 0,
      promo: input.sale.promo ?? null,
      paymentMethod: input.sale.paymentMethod,
      manualDiscountAmount: 0,
    });
    const ceiling = rupiah((preview.totals.subtotal * settings.cashierDiscountLimitPct) / 100);
    if (manualDiscount > ceiling) {
      const grant = await verifySupervisorPin({
        pin: input.sale.supervisorPin ?? "",
        action: "MANUAL_DISCOUNT",
        actorId: input.actorId,
        entityType: "sales_order",
        entityId: input.sale.clientRequestId,
        metadata: { manualDiscount, ceiling, limitPct: settings.cashierDiscountLimitPct },
      });
      authorizedBy = grant.supervisorId;
    }
  }

  const result = await persistSale({
    item: input.sale,
    syncMode: "DIRECT_ONLINE",
    actorId: input.actorId,
    allowNegativeStock: false,
  });

  if (result.status === "REJECTED") {
    throwServiceError(result.message ?? "Transaksi ditolak.", 400);
  }
  if (authorizedBy && result.orderId) {
    await writeAudit({
      actorId: input.actorId,
      authorizedById: authorizedBy,
      action: "MANUAL_DISCOUNT_AUTHORIZED",
      entityType: "sales_order",
      entityId: result.orderId,
      metadata: { manualDiscount },
    });
  }
  return result;
}

/** Void a paid receipt. Always requires a supervisor PIN. */
export async function voidOrder(input: {
  orderId: string;
  actorId: string;
  supervisorPin: string;
  reason: string;
}): Promise<{ orderId: string; receiptNumber: string; restoredItems: number }> {
  const db = await getDb();
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, input.orderId)).limit(1);
  if (!order) throwServiceError("Transaksi tidak ditemukan.", 404);
  if (order.status === "VOIDED") throwServiceError("Transaksi ini sudah di-void.", 409);
  if (!input.reason.trim()) throwServiceError("Alasan void wajib diisi.", 400);

  const grant = await verifySupervisorPin({
    pin: input.supervisorPin,
    action: "VOID_ORDER",
    actorId: input.actorId,
    entityType: "sales_order",
    entityId: order.id,
    metadata: { receiptNumber: order.receiptNumber, reason: input.reason },
  });

  const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, order.id));

  for (const item of items) {
    if (!item.productId) continue;
    await applyStockMovement({
      productId: item.productId,
      movementType: "POS_VOID_RETURN",
      referenceId: order.receiptNumber,
      qtyChange: item.qty,
      unitCost: toNumber(item.unitCogsSnapshot),
      actorId: input.actorId,
      notes: `Void struk oleh supervisor: ${input.reason.trim()}`,
      allowNegative: false,
    });
  }

  await db
    .update(salesOrders)
    .set({
      status: "VOIDED",
      voidedAt: new Date(),
      voidedBySupervisor: grant.supervisorId,
      voidReason: input.reason.trim(),
    })
    .where(eq(salesOrders.id, order.id));

  await writeAudit({
    actorId: input.actorId,
    authorizedById: grant.supervisorId,
    action: "ORDER_VOIDED",
    entityType: "sales_order",
    entityId: order.id,
    severity: "WARNING",
    metadata: {
      receiptNumber: order.receiptNumber,
      grandTotal: toNumber(order.grandTotal),
      reason: input.reason.trim(),
      supervisor: grant.supervisorName,
    },
  });

  return { orderId: order.id, receiptNumber: order.receiptNumber, restoredItems: items.length };
}

/** Partial or full refund with optional restock, supervisor-gated. */
export async function refundOrder(input: {
  orderId: string;
  actorId: string;
  supervisorPin: string;
  reason: string;
  restockItems: boolean;
  lines: { itemId: string; qty: number }[];
}): Promise<{ returnId: string; returnNumber: string; refundAmount: number; status: "PARTIALLY_REFUNDED" | "REFUNDED" }> {
  const db = await getDb();
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, input.orderId)).limit(1);
  if (!order) throwServiceError("Transaksi tidak ditemukan.", 404);
  if (order.status === "VOIDED") throwServiceError("Transaksi void tidak dapat diretur.", 409);
  if (!input.lines.length) throwServiceError("Pilih minimal satu item untuk diretur.", 400);

  const grant = await verifySupervisorPin({
    pin: input.supervisorPin,
    action: "ORDER_REFUND",
    actorId: input.actorId,
    entityType: "sales_order",
    entityId: order.id,
    metadata: { receiptNumber: order.receiptNumber, reason: input.reason },
  });

  const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, order.id));
  const itemsById = new Map(items.map((item) => [item.id, item]));

  let refundAmount = 0;
  const applied: { item: typeof items[number]; qty: number }[] = [];

  for (const line of input.lines) {
    const item = itemsById.get(line.itemId);
    if (!item) throwServiceError("Item retur tidak ditemukan pada struk ini.", 400);
    const remaining = item.qty - item.refundedQty;
    const qty = Math.min(Math.max(0, Math.trunc(line.qty)), remaining);
    if (qty <= 0) continue;
    refundAmount += toNumber(item.appliedUnitPrice) * qty;
    applied.push({ item, qty });
  }

  if (refundAmount <= 0) throwServiceError("Tidak ada kuantitas yang bisa diretur.", 400);
  refundAmount = rupiah(refundAmount);

  const returnNumber = await nextDocumentNumber("return", "RTR-YYYYMMDD", 4);
  const [ret] = await db
    .insert(returnsRefunds)
    .values({
      returnNumber,
      orderId: order.id,
      shiftId: order.shiftId,
      processedBy: input.actorId,
      authorizedBySupervisor: grant.supervisorId,
      refundAmount: moneyString(refundAmount),
      restockItems: input.restockItems,
      reason: input.reason.trim() || "Retur pelanggan",
    })
    .returning();

  let allRefunded = true;
  for (const { item, qty } of applied) {
    await db
      .update(salesOrderItems)
      .set({ refundedQty: sql`${salesOrderItems.refundedQty} + ${qty}` })
      .where(eq(salesOrderItems.id, item.id));

    const newRefunded = item.refundedQty + qty;
    if (newRefunded < item.qty) allRefunded = false;

    if (input.restockItems && item.productId) {
      await applyStockMovement({
        productId: item.productId,
        movementType: "POS_VOID_RETURN",
        referenceId: returnNumber,
        qtyChange: qty,
        unitCost: toNumber(item.unitCogsSnapshot),
        actorId: input.actorId,
        notes: `Retur ${order.receiptNumber}`,
        allowNegative: false,
      });
    }
  }

  const anyRefunded = items.some((item) => {
    const appliedLine = applied.find((line) => line.item.id === item.id);
    const refunded = item.refundedQty + (appliedLine?.qty ?? 0);
    return refunded > 0;
  });
  const status: "PARTIALLY_REFUNDED" | "REFUNDED" = allRefunded && anyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";

  await db.update(salesOrders).set({ status }).where(eq(salesOrders.id, order.id));

  await writeAudit({
    actorId: input.actorId,
    authorizedById: grant.supervisorId,
    action: "ORDER_REFUNDED",
    entityType: "sales_order",
    entityId: order.id,
    severity: "WARNING",
    metadata: {
      receiptNumber: order.receiptNumber,
      returnNumber,
      refundAmount,
      restockItems: input.restockItems,
      lines: applied.map(({ item, qty }) => ({ sku: item.skuSnapshot, qty })),
    },
  });

  return { returnId: ret.id, returnNumber, refundAmount, status };
}

/** Cash drop straight to the safe, used from the POS drawer panel. */
export async function shiftCashSummary(shiftId: string) {
  const db = await getDb();
  const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId)).limit(1);
  if (!shift) return null;
  const [payments] = await db
    .select({
      cashTotal: sql<string>`coalesce(sum(case when ${salesPayments.method} = 'CASH' then ${salesPayments.amount} else 0 end), 0)`,
      nonCashTotal: sql<string>`coalesce(sum(case when ${salesPayments.method} <> 'CASH' then ${salesPayments.amount} else 0 end), 0)`,
    })
    .from(salesPayments)
    .innerJoin(salesOrders, and(eq(salesOrders.id, salesPayments.orderId), eq(salesOrders.shiftId, shiftId)))
    .where(sql`${salesOrders.status} <> 'VOIDED'`);
  return {
    shift,
    cashTotal: toNumber(payments?.cashTotal),
    nonCashTotal: toNumber(payments?.nonCashTotal),
  };
}

export async function productStockSnapshot(productIds: string[]) {
  if (!productIds.length) return [];
  const db = await getDb();
  return db
    .select({ id: products.id, name: products.name, sku: products.sku, stockOnHand: products.stockOnHand })
    .from(products)
    .where(inArray(products.id, productIds));
}
