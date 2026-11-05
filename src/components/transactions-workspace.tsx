"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Panel, Badge, KeyValue, Money, StatusBadge, Stat } from "@/components/ui";
import { EnterpriseDataGrid, type GridColumn, type GridFacet } from "@/components/data-grid";
import { InspectorDrawer } from "@/components/inspector-drawer";
import { formatDateTime, formatIdr, toNumber } from "@/lib/format";

type OrderRow = {
  id: string;
  receiptNumber: string;
  createdAt: string;
  status: string;
  syncMode: string;
  paymentMethod: string;
  grandTotal: number;
  subtotal: number;
  taxAmount: number;
  totalCogs: number;
  cashierName: string | null;
  shiftNumber: string | null;
  voidReason: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Selesai",
  VOIDED: "Void",
  PARTIALLY_REFUNDED: "Retur sebagian",
  REFUNDED: "Retur penuh",
};

export function TransactionsWorkspace({
  orders,
  search,
  status,
}: {
  orders: OrderRow[];
  search: string;
  status: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = orders;
  const totalNet = rows.filter((row) => row.status !== "VOIDED").reduce((sum, row) => sum + row.grandTotal, 0);
  const voided = rows.filter((row) => row.status === "VOIDED");
  const offline = rows.filter((row) => row.syncMode === "SYNCED_FROM_OFFLINE").length;
  const open = rows.find((row) => row.id === openId) ?? null;

  const facets: GridFacet[] = useMemo(
    () => [
      { key: "all", label: "Semua", count: rows.length },
      { key: "COMPLETED", label: STATUS_LABEL.COMPLETED, count: rows.filter((row) => row.status === "COMPLETED").length },
      { key: "VOIDED", label: STATUS_LABEL.VOIDED, count: voided.length },
      {
        key: "REFUNDED",
        label: "Retur",
        count: rows.filter((row) => row.status === "PARTIALLY_REFUNDED" || row.status === "REFUNDED").length,
      },
      { key: "OFFLINE", label: "Offline", count: offline },
    ],
    [offline, rows, voided.length],
  );

  const columns: GridColumn<OrderRow>[] = [
    {
      key: "receipt",
      header: "Struk",
      sortValue: (row) => row.receiptNumber,
      render: (row) => <span className="num text-[0.75rem] font-medium">{row.receiptNumber}</span>,
    },
    {
      key: "time",
      header: "Waktu",
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="num text-[0.75rem] text-ink-600">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: "cashier",
      header: "Kasir",
      sortValue: (row) => row.cashierName ?? "",
      render: (row) => <span className="text-[0.75rem]">{row.cashierName ?? "-"}</span>,
    },
    {
      key: "method",
      header: "Bayar",
      sortValue: (row) => row.paymentMethod,
      render: (row) => <span className="text-[0.75rem] text-ink-600">{row.paymentMethod.replace(/_/g, " ")}</span>,
    },
    {
      key: "source",
      header: "Sumber",
      sortValue: (row) => row.syncMode,
      render: (row) =>
        row.syncMode === "SYNCED_FROM_OFFLINE" ? <Badge tone="signal">offline</Badge> : <span className="text-[0.75rem] text-ink-500">online</span>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "total",
      header: "Total",
      numeric: true,
      sortValue: (row) => row.grandTotal,
      render: (row) => <span className="num text-[0.75rem] font-medium">{formatIdr(row.grandTotal)}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Penjualan"
        title="Riwayat transaksi"
        description="Struk online dan hasil sinkronisasi luring disatukan. Klik baris untuk menginspeksi tanpa kehilangan filter."
        meta={<Badge tone="neutral">{rows.length} struk</Badge>}
        actions={
          <form action="/transactions" className="flex flex-wrap items-end gap-1.5">
            <label className="block">
              <span className="label-xs">Cari struk</span>
              <input name="q" defaultValue={search} className="field field-mono mt-1 h-8 py-0 text-[0.8125rem]" placeholder="INV-2026…" />
            </label>
            <label className="block">
              <span className="label-xs">Status</span>
              <select name="status" defaultValue={status} className="field mt-1 h-8 py-0 text-[0.8125rem]">
                <option value="">Semua</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary h-8 py-0 text-[0.8125rem]">
              Filter
            </button>
          </form>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Transaksi terlihat" value={rows.length} hint={`${offline} dari mode offline`} />
        <Stat label="Penjualan neto" value={<Money value={totalNet} />} hint="Tanpa transaksi void" tone="grove" />
        <Stat label="Struk void" value={voided.length} tone={voided.length ? "caution" : "neutral"} hint="Butuh PIN supervisor" />
        <Stat label="Nilai void" value={<Money value={voided.reduce((sum, row) => sum + row.grandTotal, 0)} />} tone={voided.length ? "alert" : "neutral"} />
      </div>

      <EnterpriseDataGrid
        rows={rows}
        columns={columns}
        facets={facets}
        facetKey={(row) =>
          row.syncMode === "SYNCED_FROM_OFFLINE"
            ? "OFFLINE"
            : row.status === "PARTIALLY_REFUNDED" || row.status === "REFUNDED"
              ? "REFUNDED"
              : row.status
        }
        caption="Daftar struk penjualan"
        onRowOpen={(row) => setOpenId(row.id)}
        emptyState={<p className="text-[0.8125rem] text-ink-500">Tidak ada transaksi cocok dengan filter ini.</p>}
      />

      <InspectorDrawer
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open?.receiptNumber ?? ""}
        subtitle={open ? `${formatDateTime(open.createdAt)} · ${open.cashierName ?? "-"}` : undefined}
        badge={open ? <StatusBadge value={open.status} /> : null}
        tabs={
          open
            ? [
                {
                  key: "summary",
                  label: "Ringkasan",
                  content: (
                    <KeyValue
                      items={[
                        { label: "Subtotal", value: <Money value={open.subtotal} /> },
                        { label: "PPN", value: <Money value={open.taxAmount} /> },
                        { label: "Total", value: <Money value={open.grandTotal} />, strong: true },
                        { label: "HPP", value: <Money value={open.totalCogs} /> },
                        {
                          label: "Laba kotor",
                          value: <Money value={toNumber(open.grandTotal) - toNumber(open.taxAmount) - toNumber(open.totalCogs)} />,
                          strong: true,
                        },
                        { label: "Shift", value: open.shiftNumber ?? "—" },
                        { label: "Metode", value: open.paymentMethod.replace(/_/g, " ") },
                        { label: "Sumber", value: open.syncMode.replace(/_/g, " ") },
                      ]}
                    />
                  ),
                },
                {
                  key: "audit",
                  label: "Jejak",
                  content: (
                    <div className="space-y-2 text-[0.8125rem]">
                      <p className="text-ink-700">
                        {open.voidReason ? `Void: ${open.voidReason}` : "Tidak ada void pada struk ini."}
                      </p>
                      <p className="num text-[0.75rem] text-ink-500">ID internal {open.id}</p>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  label: "Tindakan",
                  content: (
                    <div className="space-y-2">
                      <a href={`/transactions/${open.id}`} className="btn btn-primary w-full">
                        Buka halaman penuh (void / retur)
                      </a>
                      <a href={`/receipt/${open.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost w-full">
                        Cetak struk termal
                      </a>
                      <p className="text-[0.75rem] leading-relaxed text-ink-500">
                        Void dan retur butuh PIN Supervisor, jadi sengaja dijalankan di halaman penuh agar jejak audit dan
                        alasan tercatat lengkap.
                      </p>
                    </div>
                  ),
                },
              ]
            : []
        }
        footer={
          open ? (
            <button type="button" onClick={() => router.push(`/transactions/${open.id}`)} className="btn btn-ghost w-full">
              Lihat detail lengkap
            </button>
          ) : null
        }
      />
    </div>
  );
}
