/** GET /api/export/shifts — CSV rekonsiliasi laci kas per shift. */
import { NextResponse } from "next/server";
import { requireRole } from "@/server/rbac";
import { listShifts } from "@/server/services/shiftEngine";
import { csvResponse, timestampedFilename, toCsv } from "@/server/services/csv";
import { fail } from "@/server/services/errors";
import { toNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const shifts = await listShifts(500);

    const csv = toCsv(
      [
        "Nomor Shift",
        "Kasir",
        "Terminal",
        "Status",
        "Dibuka",
        "Ditutup",
        "Modal Awal",
        "Kas Seharusnya",
        "Uang Fisik",
        "Selisih",
        "Penjualan Neto",
        "Penjualan Tunai",
      ],
      shifts.map((shift) => [
        shift.shiftNumber,
        shift.cashierName ?? "",
        shift.terminalId,
        shift.status,
        shift.openedAt.toISOString(),
        shift.closedAt ? shift.closedAt.toISOString() : "",
        toNumber(shift.openingCash),
        shift.expectedCashSystem === null ? "" : toNumber(shift.expectedCashSystem),
        shift.actualCashCounted === null ? "" : toNumber(shift.actualCashCounted),
        shift.cashVariance === null ? "" : toNumber(shift.cashVariance),
        toNumber(shift.totalNetSales),
        toNumber(shift.totalCashSales),
      ]),
    );

    return csvResponse(csv, timestampedFilename("katalis-shift"));
  } catch (error) {
    const failure = fail(error);
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status ?? 500 });
  }
}
