"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requireRole } from "@/server/rbac";
import { fail, type ActionResult } from "@/server/services/errors";
import { closeShiftBlind, openShift, recordCashMovement, auditClosedShift } from "@/server/services/shiftEngine";
import { toNumber } from "@/lib/format";

export async function openShiftAction(input: { openingCash: number; terminalId: string }): Promise<ActionResult<{ id: string; shiftNumber: string }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const shift = await openShift({
      cashierId: user.id,
      openingCash: toNumber(input.openingCash),
      terminalId: input.terminalId,
    });
    revalidatePath("/shifts");
    revalidatePath("/pos");
    return { ok: true, data: { id: shift.id, shiftNumber: shift.shiftNumber } };
  } catch (error) {
    return fail(error);
  }
}

export async function recordCashMovementAction(input: {
  shiftId: string;
  movementType: "CASH_IN_MISC" | "CASH_OUT_EXPENSE" | "CASH_DROP_SAFE";
  amount: number;
  reason: string;
  supervisorPin?: string;
}): Promise<ActionResult<{ movementId: string; authorizedBy: string | null }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await recordCashMovement({
      shiftId: input.shiftId,
      actorId: user.id,
      movementType: input.movementType,
      amount: toNumber(input.amount),
      reason: input.reason,
      supervisorPin: input.supervisorPin,
    });
    revalidatePath("/shifts");
    revalidatePath(`/shifts/${input.shiftId}`);
    revalidatePath("/pos");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function closeShiftAction(input: {
  shiftId: string;
  actualCashCounted: number;
  closingNotes?: string;
  supervisorPin?: string;
}): Promise<
  ActionResult<{ status: string; expectedCash: number; actualCash: number; variance: number }>
> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await closeShiftBlind({
      shiftId: input.shiftId,
      actorId: user.id,
      actualCashCounted: toNumber(input.actualCashCounted),
      closingNotes: input.closingNotes,
      supervisorPin: input.supervisorPin,
    });
    revalidatePath("/shifts");
    revalidatePath(`/shifts/${input.shiftId}`);
    revalidatePath("/pos");
    revalidatePath("/admin");
    return {
      ok: true,
      data: {
        status: result.status,
        expectedCash: result.expectedCash,
        actualCash: result.actualCash,
        variance: result.variance,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function auditShiftAction(input: { shiftId: string; notes?: string }): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    await auditClosedShift({ shiftId: input.shiftId, managerId: user.id, notes: input.notes });
    revalidatePath("/shifts");
    revalidatePath(`/shifts/${input.shiftId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Current user + their open shift, polled by the terminal on focus. */
export async function terminalStatusAction(): Promise<
  ActionResult<{ userId: string; shiftId: string | null; shiftNumber: string | null }>
> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Sesi berakhir.", code: "UNAUTHENTICATED", status: 401 };
    const { findOpenShift } = await import("@/server/services/shiftEngine");
    const shift = await findOpenShift(user.id);
    return { ok: true, data: { userId: user.id, shiftId: shift?.id ?? null, shiftNumber: shift?.shiftNumber ?? null } };
  } catch (error) {
    return fail(error);
  }
}
