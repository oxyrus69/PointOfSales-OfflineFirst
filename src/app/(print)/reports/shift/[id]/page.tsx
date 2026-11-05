import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintSheet } from "@/components/print-toolbar";
import { computeShiftTotals, getShiftById, listCashMovements } from "@/server/services/shiftEngine";
import { getStoreSettings } from "@/server/services/settings";
import { listOrders } from "@/server/services/salesEngine";
import { formatDateTime, toNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Z Report" };
export const dynamic = "force-dynamic";

function rupiah(value: unknown): string {
  return toNumber(value).toLocaleString("id-ID");
}

export default async function ZReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shift = await getShiftById(id);
  if (!shift) notFound();

  const [totals, movements, orders, settings] = await Promise.all([
    computeShiftTotals(id),
    listCashMovements(id),
    listOrders({ shiftId: id, limit: 200 }),
    getStoreSettings(),
  ]);

  const completed = orders.filter((order) => order.status !== "VOIDED");
  const byMethod = completed.reduce<Record<string, { count: number; total: number }>>((acc, order) => {
    const key = order.paymentMethod.replace(/_/g, " ");
    acc[key] = acc[key] ?? { count: 0, total: 0 };
    acc[key].count += 1;
    acc[key].total += toNumber(order.grandTotal);
    return acc;
  }, {});

  const isClosed = shift.status !== "OPEN";

  return (
    <PrintSheet defaultWidth="80mm">
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "13px", fontWeight: 700 }}>{settings.storeName.toUpperCase()}</p>
        <p style={{ fontWeight: 700, marginTop: "2px" }}>Z REPORT · TUTUP SHIFT</p>
        <p>{shift.shiftNumber}</p>
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Terminal</span>
        <span>{shift.terminalId}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Dibuka</span>
        <span>{formatDateTime(shift.openedAt)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Ditutup</span>
        <span>{shift.closedAt ? formatDateTime(shift.closedAt) : "masih berjalan"}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Status</span>
        <span>{shift.status.replace(/_/g, " ")}</span>
      </p>

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <p style={{ fontWeight: 700 }}>PENJUALAN</p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Transaksi selesai</span>
        <span>{totals.transactionCount}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Bruto</span>
        <span>{rupiah(totals.grossSales)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Diskon</span>
        <span>-{rupiah(totals.discounts)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>PPN</span>
        <span>{rupiah(totals.tax)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>Neto</span>
        <span>{rupiah(totals.netSales)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Void</span>
        <span>{rupiah(totals.voidAmount)}</span>
      </p>

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <p style={{ fontWeight: 700 }}>METODE BAYAR</p>
      {Object.entries(byMethod).map(([method, value]) => (
        <p key={method} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            {method} ({value.count})
          </span>
          <span>{rupiah(value.total)}</span>
        </p>
      ))}

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <p style={{ fontWeight: 700 }}>LACI KAS</p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Modal awal</span>
        <span>{rupiah(shift.openingCash)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Penjualan tunai</span>
        <span>{rupiah(totals.cashSales)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Kas masuk</span>
        <span>{rupiah(totals.cashInMisc)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Kas keluar</span>
        <span>-{rupiah(totals.cashOutExpense)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Setor brankas</span>
        <span>-{rupiah(totals.cashDropSafe)}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>Seharusnya</span>
        <span>{isClosed ? rupiah(shift.expectedCashSystem) : "—"}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Fisik dihitung</span>
        <span>{isClosed ? rupiah(shift.actualCashCounted) : "—"}</span>
      </p>
      <p style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>Selisih</span>
        <span>{isClosed ? rupiah(shift.cashVariance) : "—"}</span>
      </p>

      {movements.filter((movement) => movement.movementType !== "OPENING_FLOAT").length ? (
        <>
          <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
          <p style={{ fontWeight: 700 }}>PERGERAKAN KAS</p>
          {movements
            .filter((movement) => movement.movementType !== "OPENING_FLOAT")
            .slice(0, 12)
            .map((movement) => (
              <p key={movement.id} style={{ marginBottom: "2px" }}>
                {movement.movementType === "CASH_OUT_EXPENSE" ? "-" : ""}
                {rupiah(movement.amount)} · {movement.reason.slice(0, 30)}
              </p>
            ))}
        </>
      ) : null}

      {shift.closingNotes ? (
        <>
          <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
          <p>Catatan: {shift.closingNotes}</p>
        </>
      ) : null}

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <p style={{ textAlign: "center", fontSize: "10px" }}>Dicetak {formatDateTime(new Date())}</p>
      <p style={{ textAlign: "center", fontSize: "10px" }}>Dokumen internal — bukan bukti pembayaran pelanggan.</p>
    </PrintSheet>
  );
}
