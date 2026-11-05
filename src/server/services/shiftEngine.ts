import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  cashDrawerMovements,
  posShifts,
  profiles,
  salesOrders,
  type PosShift,
} from "@/server/db/schema";
import { computeExpectedCashPure, rupiah } from "@/lib/posMath";
import { moneyString, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/server/services/sequences";
import { getStoreSettings } from "@/server/services/settings";
import { AuthError, writeAudit } from "@/server/rbac";
import { verifySupervisorPin } from "@/server/services/supervisorAuth";
import { throwServiceError } from "@/server/services/errors";

export type ShiftTotals = {
  grossSales: number;
  discounts: number;
  tax: number;
  netSales: number;
  cashSales: number;
  nonCashSales: number;
  voidAmount: number;
  cashInMisc: number;
  cashOutExpense: number;
  cashDropSafe: number;
  cashRefund: number;
  expectedCash: number;
  transactionCount: number;
};

export async function findOpenShift(cashierId?: string): Promise<PosShift | null> {
  const db = await getDb();
  const conditions = cashierId
    ? and(eq(posShifts.status, "OPEN"), eq(posShifts.cashierId, cashierId))
    : eq(posShifts.status, "OPEN");
  const [row] = await db.select().from(posShifts).where(conditions).orderBy(desc(posShifts.openedAt)).limit(1);
  return row ?? null;
}

export async function getShiftById(shiftId: string): Promise<PosShift | null> {
  const db = await getDb();
  const [row] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId)).limit(1);
  return row ?? null;
}

export async function openShift(input: {
  cashierId: string;
  openingCash: number;
  terminalId?: string;
}): Promise<PosShift> {
  const db = await getDb();
  const existing = await findOpenShift(input.cashierId);
  if (existing) {
    throwServiceError(`Shift ${existing.shiftNumber} masih OPEN. Tutup shift tersebut sebelum membuka shift baru.`, 409);
  }

  const openingCash = rupiah(Math.max(0, input.openingCash));
  const shiftNumber = await nextDocumentNumber("shift", "SHF-YYYYMM");
  const terminalId = (input.terminalId ?? "KASIR-01").trim() || "KASIR-01";

  const [shift] = await db
    .insert(posShifts)
    .values({
      shiftNumber,
      cashierId: input.cashierId,
      terminalId,
      status: "OPEN",
      openingCash: moneyString(openingCash),
      openedAt: new Date(),
    })
    .returning();

  await db.insert(cashDrawerMovements).values({
    shiftId: shift.id,
    actorId: input.cashierId,
    movementType: "OPENING_FLOAT",
    amount: moneyString(openingCash),
    reason: "Modal awal laci kasir",
  });

  await writeAudit({
    actorId: input.cashierId,
    action: "SHIFT_OPENED",
    entityType: "pos_shift",
    entityId: shift.id,
    metadata: { shiftNumber, openingCash, terminalId },
  });

  return shift;
}

export async function recordCashMovement(input: {
  shiftId: string;
  actorId: string;
  movementType: "CASH_IN_MISC" | "CASH_OUT_EXPENSE" | "CASH_DROP_SAFE";
  amount: number;
  reason: string;
  supervisorPin?: string | null;
}): Promise<{ movementId: string; authorizedBy: string | null }> {
  const db = await getDb();
  const shift = await getShiftById(input.shiftId);
  if (!shift) throwServiceError("Shift tidak ditemukan.", 404);
  if (shift.status !== "OPEN") throwServiceError("Shift sudah ditutup. Kas tidak bisa diubah lagi.", 409);

  const amount = rupiah(input.amount);
  if (amount <= 0) throwServiceError("Nominal kas harus lebih besar dari nol.", 400);
  if (!input.reason.trim()) throwServiceError("Alasan pergerakan kas wajib diisi.", 400);

  const settings = await getStoreSettings();
  let authorizedBy: string | null = null;

  const needsPin =
    (input.movementType === "CASH_OUT_EXPENSE" && amount > settings.cashOutPinThreshold) ||
    (input.movementType === "CASH_DROP_SAFE" && amount > settings.cashOutPinThreshold * 3);

  if (needsPin) {
    const grant = await verifySupervisorPin({
      pin: input.supervisorPin ?? "",
      action: "CASH_MOVEMENT",
      actorId: input.actorId,
      entityType: "pos_shift",
      entityId: input.shiftId,
      metadata: { amount, movementType: input.movementType },
    });
    authorizedBy = grant.supervisorId;
  }

  const [movement] = await db
    .insert(cashDrawerMovements)
    .values({
      shiftId: input.shiftId,
      actorId: input.actorId,
      authorizedBy,
      movementType: input.movementType,
      amount: moneyString(amount),
      reason: input.reason.trim(),
    })
    .returning();

  await writeAudit({
    actorId: input.actorId,
    authorizedById: authorizedBy,
    action: `CASH_${input.movementType}`,
    entityType: "cash_movement",
    entityId: movement.id,
    metadata: { amount, shiftNumber: shift.shiftNumber, reason: input.reason.trim() },
  });

  return { movementId: movement.id, authorizedBy };
}

/** All money flow for one shift, computed from the immutable rows. */
export async function computeShiftTotals(shiftId: string): Promise<ShiftTotals> {
  const db = await getDb();
  const shift = await getShiftById(shiftId);
  if (!shift) throwServiceError("Shift tidak ditemukan.", 404);

  const orders = await db
    .select({
      status: salesOrders.status,
      paymentMethod: salesOrders.paymentMethod,
      grandTotal: salesOrders.grandTotal,
      subtotal: salesOrders.subtotal,
      discount: sql<string>`(
        ${salesOrders.tierDiscountTotal} + ${salesOrders.memberDiscountAmount} +
        ${salesOrders.promoDiscountAmount} + ${salesOrders.manualDiscountAmount}
      )`,
      tax: salesOrders.taxAmount,
      cashReceived: salesOrders.cashReceived,
    })
    .from(salesOrders)
    .where(eq(salesOrders.shiftId, shiftId));

  const movements = await db
    .select({
      movementType: cashDrawerMovements.movementType,
      amount: cashDrawerMovements.amount,
    })
    .from(cashDrawerMovements)
    .where(eq(cashDrawerMovements.shiftId, shiftId));

  let grossSales = 0;
  let discounts = 0;
  let tax = 0;
  let netSales = 0;
  let cashSales = 0;
  let nonCashSales = 0;
  let voidAmount = 0;
  let transactionCount = 0;

  for (const order of orders) {
    if (order.status === "VOIDED") {
      voidAmount += toNumber(order.grandTotal);
      continue;
    }
    transactionCount += 1;
    const gross = toNumber(order.subtotal);
    grossSales += gross;
    discounts += toNumber(order.discount);
    tax += toNumber(order.tax);
    netSales += toNumber(order.grandTotal);

    if (order.paymentMethod === "CASH") cashSales += toNumber(order.grandTotal);
    else nonCashSales += toNumber(order.grandTotal);
  }

  let cashInMisc = 0;
  let cashOutExpense = 0;
  let cashDropSafe = 0;
  for (const movement of movements) {
    const amount = toNumber(movement.amount);
    if (movement.movementType === "CASH_IN_MISC") cashInMisc += amount;
    else if (movement.movementType === "CASH_OUT_EXPENSE") cashOutExpense += amount;
    else if (movement.movementType === "CASH_DROP_SAFE") cashDropSafe += amount;
  }

  const cashRefund = 0;
  const expectedCash = computeExpectedCashPure({
    openingCash: toNumber(shift.openingCash),
    cashSales,
    cashRefunds: cashRefund,
    cashInMisc,
    cashOutExpense,
    cashDropSafe,
  });

  return {
    grossSales,
    discounts,
    tax,
    netSales,
    cashSales,
    nonCashSales,
    voidAmount,
    cashInMisc,
    cashOutExpense,
    cashDropSafe,
    cashRefund,
    expectedCash,
    transactionCount,
  };
}

/**
 * Blind close: the caller passes only what the cashier physically counted.
 * The expected figure is computed server-side and never sent to the UI first.
 */
export async function closeShiftBlind(input: {
  shiftId: string;
  actorId: string;
  actualCashCounted: number;
  closingNotes?: string;
  supervisorPin?: string | null;
}): Promise<{
  shift: PosShift;
  expectedCash: number;
  actualCash: number;
  variance: number;
  status: "CLOSED_MATCHED" | "CLOSED_WITH_VARIANCE";
  totals: ShiftTotals;
}> {
  const db = await getDb();
  const shift = await getShiftById(input.shiftId);
  if (!shift) throwServiceError("Shift tidak ditemukan.", 404);
  if (shift.status !== "OPEN") throwServiceError("Shift ini sudah ditutup.", 409);
  if (shift.cashierId !== input.actorId) {
    throwServiceError("Hanya kasir pemilik shift yang boleh menutup shift ini.", 403);
  }

  const actualCash = rupiah(input.actualCashCounted);
  if (actualCash < 0) throwServiceError("Jumlah uang fisik tidak boleh negatif.", 400);

  const totals = await computeShiftTotals(input.shiftId);
  const expectedCash = totals.expectedCash;
  const variance = actualCash - expectedCash;
  const settings = await getStoreSettings();
  const needsPin = Math.abs(variance) > Math.max(settings.varianceToleranceIdr, 50000);

  let authorizedBy: string | null = null;
  if (needsPin) {
    const grant = await verifySupervisorPin({
      pin: input.supervisorPin ?? "",
      action: "SHIFT_CLOSE_VARIANCE",
      actorId: input.actorId,
      entityType: "pos_shift",
      entityId: input.shiftId,
      metadata: { actualCash, expectedCash, variance },
    });
    authorizedBy = grant.supervisorId;
  }

  const status: "CLOSED_MATCHED" | "CLOSED_WITH_VARIANCE" = variance === 0 ? "CLOSED_MATCHED" : "CLOSED_WITH_VARIANCE";

  const [updated] = await db
    .update(posShifts)
    .set({
      status,
      closedAt: new Date(),
      expectedCashSystem: moneyString(expectedCash),
      actualCashCounted: moneyString(actualCash),
      cashVariance: moneyString(variance),
      totalSalesGross: moneyString(totals.grossSales),
      totalDiscounts: moneyString(totals.discounts),
      totalTax: moneyString(totals.tax),
      totalNetSales: moneyString(totals.netSales),
      totalCashSales: moneyString(totals.cashSales),
      totalNonCashSales: moneyString(totals.nonCashSales),
      totalVoidAmount: moneyString(totals.voidAmount),
      closingNotes: input.closingNotes?.trim() || null,
      version: sql`${posShifts.version} + 1`,
    })
    .where(and(eq(posShifts.id, input.shiftId), eq(posShifts.status, "OPEN")))
    .returning();

  if (!updated) throwServiceError("Shift berubah saat penutupan (optimistic lock). Muat ulang halaman.", 409);

  await writeAudit({
    actorId: input.actorId,
    authorizedById: authorizedBy,
    action: "SHIFT_CLOSED_BLIND",
    entityType: "pos_shift",
    entityId: input.shiftId,
    severity: status === "CLOSED_WITH_VARIANCE" ? "WARNING" : "INFO",
    metadata: {
      shiftNumber: shift.shiftNumber,
      expectedCash,
      actualCash,
      variance,
      transactionCount: totals.transactionCount,
      closingNotes: input.closingNotes ?? null,
    },
  });

  return { shift: updated, expectedCash, actualCash, variance, status, totals };
}

export async function auditClosedShift(input: {
  shiftId: string;
  managerId: string;
  notes?: string;
}): Promise<PosShift> {
  const db = await getDb();
  const shift = await getShiftById(input.shiftId);
  if (!shift) throwServiceError("Shift tidak ditemukan.", 404);
  if (shift.status === "OPEN") throwServiceError("Shift masih berjalan, tidak bisa diaudit.", 409);
  if (shift.status === "AUDITED") throwServiceError("Shift ini sudah diaudit.", 409);

  const [updated] = await db
    .update(posShifts)
    .set({
      status: "AUDITED",
      auditedBy: input.managerId,
      closingNotes: input.notes ? `${shift.closingNotes ? `${shift.closingNotes}\n` : ""}${input.notes}` : shift.closingNotes,
      version: sql`${posShifts.version} + 1`,
    })
    .where(eq(posShifts.id, input.shiftId))
    .returning();

  await writeAudit({
    actorId: input.managerId,
    action: "SHIFT_AUDITED",
    entityType: "pos_shift",
    entityId: input.shiftId,
    metadata: { shiftNumber: shift.shiftNumber, variance: shift.cashVariance, notes: input.notes ?? null },
  });

  return updated;
}

export async function listShifts(limit = 50) {
  const db = await getDb();
  return db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      cashierName: profiles.fullName,
      cashierId: posShifts.cashierId,
      terminalId: posShifts.terminalId,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      closedAt: posShifts.closedAt,
      openingCash: posShifts.openingCash,
      expectedCashSystem: posShifts.expectedCashSystem,
      actualCashCounted: posShifts.actualCashCounted,
      cashVariance: posShifts.cashVariance,
      totalNetSales: posShifts.totalNetSales,
      totalCashSales: posShifts.totalCashSales,
    })
    .from(posShifts)
    .leftJoin(profiles, eq(profiles.id, posShifts.cashierId))
    .orderBy(desc(posShifts.openedAt))
    .limit(limit);
}

export async function listCashMovements(shiftId: string) {
  const db = await getDb();
  return db
    .select({
      id: cashDrawerMovements.id,
      movementType: cashDrawerMovements.movementType,
      amount: cashDrawerMovements.amount,
      reason: cashDrawerMovements.reason,
      createdAt: cashDrawerMovements.createdAt,
      actorName: profiles.fullName,
      authorizedBy: cashDrawerMovements.authorizedBy,
    })
    .from(cashDrawerMovements)
    .leftJoin(profiles, eq(profiles.id, cashDrawerMovements.actorId))
    .where(eq(cashDrawerMovements.shiftId, shiftId))
    .orderBy(desc(cashDrawerMovements.createdAt));
}

/** Shift that a cashier must have before the POS pay button unlocks. */
export async function requireOpenShift(cashierId: string): Promise<PosShift> {
  const shift = await findOpenShift(cashierId);
  if (!shift) {
    throw new AuthError("Belum ada shift OPEN. Buka shift terlebih dahulu di halaman Shift.", 409);
  }
  return shift;
}
