"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/rbac";
import { fail, type ActionResult } from "@/server/services/errors";
import { completeSale, refundOrder, voidOrder } from "@/server/services/salesActions";
import type { SyncBatchItem } from "@/server/services/posSyncEngine";
import { syncOfflineBatch } from "@/server/services/posSyncEngine";

export type CheckoutPayload = {
  clientRequestId: string;
  createdAt: string;
  shiftId: string;
  customerId: string | null;
  memberDiscountPct: number;
  manualDiscountAmount: number;
  supervisorPin?: string;
  promo: SyncBatchItem["promo"];
  paymentMethod: SyncBatchItem["paymentMethod"];
  cashReceived: number;
  paymentReference: string | null;
  payments: { method: "CASH" | "QRIS" | "DEBIT_CARD" | "CREDIT_CARD"; amount: number; reference?: string | null }[];
  items: { productId: string; qty: number; appliedUnitPrice?: number }[];
  clientTotal: number;
};

export async function checkoutAction(
  payload: CheckoutPayload,
): Promise<ActionResult<{ orderId: string; receiptNumber: string; grandTotal: number }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await completeSale({
      actorId: user.id,
      sale: {
        clientRequestId: payload.clientRequestId,
        createdAt: payload.createdAt,
        cashierId: user.id,
        shiftId: payload.shiftId,
        customerId: payload.customerId,
        memberDiscountPct: payload.memberDiscountPct,
        manualDiscountAmount: payload.manualDiscountAmount,
        supervisorPin: payload.supervisorPin,
        promo: payload.promo,
        paymentMethod: payload.paymentMethod,
        cashReceived: payload.cashReceived,
        paymentReference: payload.paymentReference,
        payments: payload.payments,
        items: payload.items,
        clientTotal: payload.clientTotal,
      },
    });

    if (result.status === "REJECTED") {
      return { ok: false, error: result.message ?? "Transaksi ditolak." };
    }

    revalidatePath("/pos");
    revalidatePath("/transactions");
    revalidatePath("/admin");
    revalidatePath("/shifts");
    return {
      ok: true,
      data: {
        orderId: result.orderId ?? "",
        receiptNumber: result.receiptNumber ?? "",
        grandTotal: payload.clientTotal,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function syncOutboxAction(
  items: SyncBatchItem[],
): Promise<ActionResult<{ synced: number; alreadySynced: number; rejected: number; results: unknown[] }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await syncOfflineBatch({ actorId: user.id, items });
    revalidatePath("/pos/sync");
    revalidatePath("/pos");
    revalidatePath("/transactions");
    return { ok: true, data: { ...result, results: result.results } };
  } catch (error) {
    return fail(error);
  }
}

export async function voidOrderAction(input: {
  orderId: string;
  supervisorPin: string;
  reason: string;
}): Promise<ActionResult<{ receiptNumber: string; restoredItems: number }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await voidOrder({
      orderId: input.orderId,
      actorId: user.id,
      supervisorPin: input.supervisorPin,
      reason: input.reason,
    });
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${input.orderId}`);
    revalidatePath("/admin/audit");
    return { ok: true, data: { receiptNumber: result.receiptNumber, restoredItems: result.restoredItems } };
  } catch (error) {
    return fail(error);
  }
}

export async function refundOrderAction(input: {
  orderId: string;
  supervisorPin: string;
  reason: string;
  restockItems: boolean;
  lines: { itemId: string; qty: number }[];
}): Promise<ActionResult<{ returnNumber: string; refundAmount: number; status: string }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const result = await refundOrder({
      orderId: input.orderId,
      actorId: user.id,
      supervisorPin: input.supervisorPin,
      reason: input.reason,
      restockItems: input.restockItems,
      lines: input.lines,
    });
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${input.orderId}`);
    return {
      ok: true,
      data: { returnNumber: result.returnNumber, refundAmount: result.refundAmount, status: result.status },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveConflictAction(input: {
  conflictId: string;
  notes: string;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const { resolveSyncConflict } = await import("@/server/services/posSyncEngine");
    await resolveSyncConflict({ conflictId: input.conflictId, managerId: user.id, notes: input.notes });
    revalidatePath("/pos/sync");
    revalidatePath("/dss");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
