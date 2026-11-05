import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  products,
  purchaseReceiptItems,
  purchaseReceipts,
  stockLedgers,
  stockOpnameItems,
  stockOpnames,
  suppliers,
  type StockMovementType,
} from "@/server/db/schema";
import { computeWeightedAverageCogsPure, rupiah } from "@/lib/posMath";
import { moneyString, toInt, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/server/services/sequences";
import { throwServiceError } from "@/server/services/errors";
import { writeAudit } from "@/server/rbac";

/**
 * Single writer for stock. Every quantity change goes through here so the
 * ledger and products.stock_on_hand can never disagree: the row is locked by
 * the UPDATE ... RETURNING, then the ledger row records before/after.
 */
export async function applyStockMovement(input: {
  productId: string;
  movementType: StockMovementType;
  referenceId: string;
  qtyChange: number;
  unitCost?: number;
  actorId?: string | null;
  notes?: string | null;
  allowNegative?: boolean;
}): Promise<{ qtyBefore: number; qtyAfter: number }> {
  const db = await getDb();
  const delta = Math.trunc(input.qtyChange);
  if (delta === 0) {
    const [current] = await db
      .select({ stockOnHand: products.stockOnHand })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!current) throwServiceError("Produk tidak ditemukan.", 404);
    return { qtyBefore: current.stockOnHand, qtyAfter: current.stockOnHand };
  }

  const [updated] = await db
    .update(products)
    .set({
      stockOnHand: sql`${products.stockOnHand} + ${delta}`,
      version: sql`${products.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      input.allowNegative
        ? eq(products.id, input.productId)
        : and(eq(products.id, input.productId), sql`${products.stockOnHand} + ${delta} >= 0`),
    )
    .returning({ stockOnHand: products.stockOnHand, costPrice: products.costPrice });

  if (!updated) {
    const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!exists) throwServiceError("Produk tidak ditemukan.", 404);
    throwServiceError("Stok tidak mencukupi untuk pergerakan ini.", 409, "INSUFFICIENT_STOCK");
  }

  const qtyAfter = updated.stockOnHand;
  const qtyBefore = qtyAfter - delta;

  await db.insert(stockLedgers).values({
    productId: input.productId,
    movementType: input.movementType,
    referenceId: input.referenceId,
    qtyChange: delta,
    qtyBefore,
    qtyAfter,
    unitCostAtMovement: moneyString(input.unitCost ?? toNumber(updated.costPrice)),
    actorId: input.actorId ?? null,
    notes: input.notes ?? null,
  });

  return { qtyBefore, qtyAfter };
}

export async function listSuppliers() {
  const db = await getDb();
  return db.select().from(suppliers).orderBy(suppliers.name);
}

export async function createPurchaseReceipt(input: {
  supplierId?: string | null;
  receivedBy: string;
  notes?: string | null;
  items: { productId: string; qty: number; unitCost: number }[];
}): Promise<{ receiptId: string; receiptNumber: string; totalAmount: number }> {
  const db = await getDb();
  if (!input.items.length) throwServiceError("Penerimaan barang harus memiliki minimal satu item.", 400);

  const receiptNumber = await nextDocumentNumber("purchase", "PRC-YYYYMMDD", 4);
  let totalAmount = 0;

  const [receipt] = await db
    .insert(purchaseReceipts)
    .values({
      receiptNumber,
      supplierId: input.supplierId ?? null,
      receivedBy: input.receivedBy,
      notes: input.notes?.trim() || null,
      totalAmount: "0",
    })
    .returning();

  for (const item of input.items) {
    const qty = Math.trunc(item.qty);
    const unitCost = rupiah(item.unitCost);
    if (qty <= 0) throwServiceError("Kuantitas penerimaan harus lebih dari nol.", 400);
    if (unitCost <= 0) throwServiceError("Harga beli harus lebih dari nol.", 400);

    const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    if (!product) throwServiceError(`Produk ${item.productId} tidak ditemukan.`, 404);

    const newCogs = computeWeightedAverageCogsPure(
      product.stockOnHand,
      toNumber(product.costPrice),
      qty,
      unitCost,
    );

    const lineTotal = rupiah(unitCost * qty);
    totalAmount += lineTotal;

    await db.insert(purchaseReceiptItems).values({
      receiptId: receipt.id,
      productId: product.id,
      qty,
      unitCost: moneyString(unitCost),
      lineTotal: moneyString(lineTotal),
    });

    await applyStockMovement({
      productId: product.id,
      movementType: "PURCHASE_RECEIVE",
      referenceId: receiptNumber,
      qtyChange: qty,
      unitCost,
      actorId: input.receivedBy,
      notes: `Penerimaan dari ${input.supplierId ? "supplier" : "tanpa supplier"}`,
    });

    await db
      .update(products)
      .set({ costPrice: moneyString(newCogs), updatedAt: new Date(), version: sql`${products.version} + 1` })
      .where(eq(products.id, product.id));
  }

  await db
    .update(purchaseReceipts)
    .set({ totalAmount: moneyString(totalAmount) })
    .where(eq(purchaseReceipts.id, receipt.id));

  await writeAudit({
    actorId: input.receivedBy,
    action: "PURCHASE_RECEIVED",
    entityType: "purchase_receipt",
    entityId: receipt.id,
    metadata: { receiptNumber, totalAmount, itemCount: input.items.length },
  });

  return { receiptId: receipt.id, receiptNumber, totalAmount };
}

export async function listPurchaseReceipts(limit = 40) {
  const db = await getDb();
  return db
    .select({
      id: purchaseReceipts.id,
      receiptNumber: purchaseReceipts.receiptNumber,
      receivedAt: purchaseReceipts.receivedAt,
      totalAmount: purchaseReceipts.totalAmount,
      supplierName: suppliers.name,
      notes: purchaseReceipts.notes,
    })
    .from(purchaseReceipts)
    .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .orderBy(desc(purchaseReceipts.receivedAt))
    .limit(limit);
}

export async function createStockOpname(input: {
  createdBy: string;
  notes?: string | null;
  items: { productId: string; physicalQtyCounted: number }[];
}): Promise<{ opnameId: string; opnameNumber: string; varianceValue: number }> {
  const db = await getDb();
  if (!input.items.length) throwServiceError("Opname harus memiliki minimal satu item yang dihitung.", 400);

  const opnameNumber = await nextDocumentNumber("opname", "OPN-YYYYMMDD", 3);
  const [opname] = await db
    .insert(stockOpnames)
    .values({
      opnameNumber,
      status: "DRAFT",
      createdBy: input.createdBy,
      notes: input.notes?.trim() || null,
    })
    .returning();

  let varianceValue = 0;
  for (const item of input.items) {
    const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    if (!product) throwServiceError(`Produk ${item.productId} tidak ditemukan.`, 404);
    const physical = Math.max(0, Math.trunc(item.physicalQtyCounted));
    const varianceQty = physical - product.stockOnHand;
    const varianceIdr = rupiah(varianceQty * toNumber(product.costPrice));
    varianceValue += varianceIdr;

    await db.insert(stockOpnameItems).values({
      opnameId: opname.id,
      productId: product.id,
      systemQtySnapshot: product.stockOnHand,
      physicalQtyCounted: physical,
      varianceQty,
      varianceValueIdr: moneyString(varianceIdr),
    });
  }

  await db
    .update(stockOpnames)
    .set({ totalVarianceValue: moneyString(varianceValue), status: "SUBMITTED" })
    .where(eq(stockOpnames.id, opname.id));

  await writeAudit({
    actorId: input.createdBy,
    action: "OPNAME_SUBMITTED",
    entityType: "stock_opname",
    entityId: opname.id,
    metadata: { opnameNumber, itemCount: input.items.length, varianceValue },
  });

  return { opnameId: opname.id, opnameNumber, varianceValue };
}

/** Approval is what actually moves stock; a draft opname never touches qty. */
export async function approveStockOpname(input: {
  opnameId: string;
  managerId: string;
}): Promise<{ adjusted: number }> {
  const db = await getDb();
  const [opname] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, input.opnameId)).limit(1);
  if (!opname) throwServiceError("Dokumen opname tidak ditemukan.", 404);
  if (opname.status === "APPROVED") throwServiceError("Opname ini sudah disetujui.", 409);
  if (opname.status === "REJECTED") throwServiceError("Opname ini sudah ditolak.", 409);

  const items = await db.select().from(stockOpnameItems).where(eq(stockOpnameItems.opnameId, input.opnameId));
  let adjusted = 0;

  for (const item of items) {
    if (item.varianceQty === 0) continue;
    await applyStockMovement({
      productId: item.productId,
      movementType: "OPNAME_ADJUSTMENT",
      referenceId: opname.opnameNumber,
      qtyChange: item.varianceQty,
      actorId: input.managerId,
      notes: `Penyesuaian opname (sistem ${item.systemQtySnapshot} → fisik ${item.physicalQtyCounted})`,
      allowNegative: item.varianceQty < 0,
    });
    adjusted += 1;
  }

  await db
    .update(stockOpnames)
    .set({ status: "APPROVED", approvedBy: input.managerId, approvedAt: new Date() })
    .where(eq(stockOpnames.id, input.opnameId));

  await writeAudit({
    actorId: input.managerId,
    action: "OPNAME_APPROVED",
    entityType: "stock_opname",
    entityId: input.opnameId,
    metadata: { opnameNumber: opname.opnameNumber, adjustedItems: adjusted },
  });

  return { adjusted };
}

export async function rejectStockOpname(input: { opnameId: string; managerId: string; reason: string }): Promise<void> {
  const db = await getDb();
  await db
    .update(stockOpnames)
    .set({ status: "REJECTED", approvedBy: input.managerId, approvedAt: new Date(), notes: input.reason })
    .where(eq(stockOpnames.id, input.opnameId));
  await writeAudit({
    actorId: input.managerId,
    action: "OPNAME_REJECTED",
    entityType: "stock_opname",
    entityId: input.opnameId,
    severity: "WARNING",
    metadata: { reason: input.reason },
  });
}

export async function listOpnames(limit = 30) {
  const db = await getDb();
  return db.select().from(stockOpnames).orderBy(desc(stockOpnames.createdAt)).limit(limit);
}

export async function getOpnameDetail(opnameId: string) {
  const db = await getDb();
  const [opname] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, opnameId)).limit(1);
  if (!opname) return null;
  const items = await db
    .select({
      id: stockOpnameItems.id,
      productId: stockOpnameItems.productId,
      productName: products.name,
      sku: products.sku,
      systemQtySnapshot: stockOpnameItems.systemQtySnapshot,
      physicalQtyCounted: stockOpnameItems.physicalQtyCounted,
      varianceQty: stockOpnameItems.varianceQty,
      varianceValueIdr: stockOpnameItems.varianceValueIdr,
    })
    .from(stockOpnameItems)
    .leftJoin(products, eq(products.id, stockOpnameItems.productId))
    .where(eq(stockOpnameItems.opnameId, opnameId));
  return { opname, items };
}

export async function listStockLedgers(options?: { productId?: string; limit?: number }) {
  const db = await getDb();
  return db
    .select({
      id: stockLedgers.id,
      productId: stockLedgers.productId,
      productName: products.name,
      sku: products.sku,
      movementType: stockLedgers.movementType,
      referenceId: stockLedgers.referenceId,
      qtyChange: stockLedgers.qtyChange,
      qtyBefore: stockLedgers.qtyBefore,
      qtyAfter: stockLedgers.qtyAfter,
      unitCostAtMovement: stockLedgers.unitCostAtMovement,
      notes: stockLedgers.notes,
      createdAt: stockLedgers.createdAt,
    })
    .from(stockLedgers)
    .leftJoin(products, eq(products.id, stockLedgers.productId))
    .where(options?.productId ? eq(stockLedgers.productId, options.productId) : undefined)
    .orderBy(desc(stockLedgers.createdAt))
    .limit(options?.limit ?? 120);
}

export async function writeOffDamaged(input: {
  productId: string;
  qty: number;
  actorId: string;
  reason: string;
}): Promise<void> {
  const qty = Math.trunc(input.qty);
  if (qty <= 0) throwServiceError("Kuantitas rusak harus lebih dari nol.", 400);
  await applyStockMovement({
    productId: input.productId,
    movementType: "DAMAGED_WRITE_OFF",
    referenceId: `WO-${Date.now()}`,
    qtyChange: -qty,
    actorId: input.actorId,
    notes: input.reason.trim() || "Barang rusak",
  });
}
