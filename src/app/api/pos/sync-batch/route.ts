/**
 * POST /api/pos/sync-batch — idempotent batch ingest for offline receipts.
 * The cashier device posts its whole tx_outbox; each item is handled
 * independently so one bad receipt cannot block the rest.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/server/rbac";
import { syncOfflineBatch, type SyncBatchItem } from "@/server/services/posSyncEngine";
import { fail } from "@/server/services/errors";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  productId: z.string().min(8),
  qty: z.number().int().positive().max(10_000),
  appliedUnitPrice: z.number().nonnegative().optional(),
});

const promoSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    discountValue: z.number().nonnegative(),
    minSubtotal: z.number().nonnegative(),
    maxDiscountCap: z.number().nonnegative(),
  })
  .nullable()
  .optional();

const itemSchema = z.object({
  clientRequestId: z.string().min(8).max(120),
  createdAt: z.string().min(10),
  cashierId: z.string().uuid(),
  shiftId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  memberDiscountPct: z.number().min(0).max(100).optional(),
  manualDiscountAmount: z.number().nonnegative().optional(),
  promo: promoSchema,
  paymentMethod: z.enum(["CASH", "QRIS", "DEBIT_CARD", "CREDIT_CARD", "SPLIT_PAYMENT"]),
  cashReceived: z.number().nonnegative().optional(),
  paymentReference: z.string().max(120).nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "QRIS", "DEBIT_CARD", "CREDIT_CARD", "SPLIT_PAYMENT"]),
        amount: z.number().nonnegative(),
        reference: z.string().max(120).nullable().optional(),
      }),
    )
    .optional(),
  items: z.array(lineSchema).min(1).max(200),
  clientTotal: z.number().nonnegative().optional(),
  receiptNumber: z.string().max(60).nullable().optional(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "VALIDATION_ERROR",
          message: "Payload batch tidak valid.",
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        { status: 400 },
      );
    }

    const items: SyncBatchItem[] = parsed.data.items.map((item) => ({
      ...item,
      // A cashier may only push receipts they own; managers can push any.
      cashierId: user.role === "CASHIER" ? user.id : item.cashierId,
      promo: item.promo ?? null,
    }));

    const result = await syncOfflineBatch({ actorId: user.id, items });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const failure = fail(error);
    return NextResponse.json(
      { ok: false, error: failure.code ?? "SYNC_FAILED", message: failure.error },
      { status: failure.status ?? 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "METHOD_NOT_ALLOWED", message: "Gunakan POST untuk mengirim batch transaksi offline." },
    { status: 405 },
  );
}
