/** GET /api/export/sales — CSV penjualan, siap dibuka Excel Indonesia. */
import { NextResponse } from "next/server";
import { requireRole } from "@/server/rbac";
import { listOrders } from "@/server/services/salesEngine";
import { csvResponse, timestampedFilename, toCsv } from "@/server/services/csv";
import { fail } from "@/server/services/errors";
import { toNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const url = new URL(request.url);
    const daysParam = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? Math.trunc(daysParam) : 30;

    const orders = await listOrders({ days, limit: 5000 });

    const csv = toCsv(
      [
        "Nomor Struk",
        "Tanggal",
        "Kasir",
        "Shift",
        "Status",
        "Sumber",
        "Metode Bayar",
        "Subtotal",
        "PPN",
        "Total",
        "HPP",
        "Laba Kotor",
        "Alasan Void",
      ],
      orders.map((order) => [
        order.receiptNumber,
        order.createdAt.toISOString(),
        order.cashierName ?? "",
        order.shiftNumber ?? "",
        order.status,
        order.syncMode,
        order.paymentMethod,
        toNumber(order.subtotal),
        toNumber(order.taxAmount),
        toNumber(order.grandTotal),
        toNumber(order.totalCogs),
        toNumber(order.grandTotal) - toNumber(order.taxAmount) - toNumber(order.totalCogs),
        order.voidReason ?? "",
      ]),
    );

    return csvResponse(csv, timestampedFilename("katalis-penjualan"));
  } catch (error) {
    const failure = fail(error);
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status ?? 500 });
  }
}
