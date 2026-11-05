"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, CloudUpload, Loader2, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { offlineDb, type OutboxSale, type SyncHistoryEntry } from "@/lib/offlineDb";
import { formatDateTime, formatIdr } from "@/lib/format";
import { syncOutboxAction } from "@/app/actions/pos";
import { Badge } from "@/components/ui";

type SyncResult = {
  clientRequestId: string;
  status: "SYNCED" | "ALREADY_SYNCED" | "REJECTED";
  orderId?: string;
  receiptNumber?: string;
  message?: string;
  conflicts?: { productId: string; serverQtyBefore: number; offlineQtySold: number }[];
};

export function SyncCenter({ cashierId }: { cashierId: string }) {
  const router = useRouter();
  const [outbox, setOutbox] = useState<OutboxSale[]>([]);
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<{ synced: number; alreadySynced: number; rejected: number } | null>(null);
  const [online, setOnline] = useState(true);

  const reload = useCallback(async () => {
    const [rows, hist] = await Promise.all([offlineDb.listOutbox(), offlineDb.listSyncHistory()]);
    setOutbox(rows);
    setHistory(hist);
  }, []);

  useEffect(() => {
    void reload();
    const handle = () => setOnline(navigator.onLine);
    handle();
    window.addEventListener("online", handle);
    window.addEventListener("offline", handle);
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("offline", handle);
    };
  }, [reload]);

  const runSync = useCallback(async () => {
    if (!outbox.length) {
      setMessage({ tone: "warn", text: "Antrean kosong. Tidak ada transaksi luring untuk dikirim." });
      return;
    }
    if (!navigator.onLine) {
      setMessage({ tone: "error", text: "Perangkat masih offline. Sambungkan jaringan lalu coba lagi." });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await syncOutboxAction(
        outbox.map((sale) => ({
          clientRequestId: sale.clientRequestId,
          createdAt: sale.createdAt,
          cashierId,
          shiftId: sale.shiftId,
          customerId: sale.customerId,
          memberDiscountPct: sale.memberDiscountPct,
          manualDiscountAmount: sale.manualDiscountAmount,
          promo: sale.promo,
          paymentMethod: sale.paymentMethod,
          cashReceived: sale.cashReceived,
          paymentReference: sale.paymentReference,
          payments: sale.payments,
          items: sale.items,
          clientTotal: sale.clientTotal,
        })),
      );

      if (!response.ok) {
        setMessage({ tone: "error", text: response.error });
        return;
      }

      const results = (response.data.results ?? []) as SyncResult[];
      for (const result of results) {
        await offlineDb.recordSyncHistory({
          id: `${result.clientRequestId}-${Date.now()}`,
          at: new Date().toISOString(),
          clientRequestId: result.clientRequestId,
          status: result.status,
          receiptNumber: result.receiptNumber ?? null,
          message: result.message ?? null,
        });
        if (result.status === "SYNCED" || result.status === "ALREADY_SYNCED") {
          await offlineDb.clearOutboxEntry(result.clientRequestId);
        } else {
          await offlineDb.markSaleAttempt(result.clientRequestId, result.message ?? "Ditolak server");
        }
      }

      setLastRun({
        synced: response.data.synced,
        alreadySynced: response.data.alreadySynced,
        rejected: response.data.rejected,
      });
      setMessage(
        response.data.rejected > 0
          ? {
              tone: "warn",
              text: `${response.data.synced} tersinkron, ${response.data.alreadySynced} sudah pernah masuk, ${response.data.rejected} ditolak dan tetap di antrean.`,
            }
          : {
              tone: "ok",
              text: `${response.data.synced} transaksi tersinkron${response.data.alreadySynced ? `, ${response.data.alreadySynced} idempoten` : ""}.`,
            },
      );
      await reload();
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sinkronisasi gagal." });
    } finally {
      setBusy(false);
    }
  }, [cashierId, outbox, reload, router]);

  const totalQueued = outbox.reduce((sum, sale) => sum + sale.clientTotal, 0);

  return (
    <div className="space-y-4">
      <div className="panel px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={online ? "grove" : "caution"}>
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? "Jaringan tersedia" : "Perangkat offline"}
            </Badge>
            <Badge tone={outbox.length ? "accent" : "neutral"}>{outbox.length} struk di antrean</Badge>
            <span className="num text-[0.8125rem] text-ink-600">{formatIdr(totalQueued)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void reload()} className="btn btn-ghost">
              <RefreshCw size={14} /> Muat ulang
            </button>
            <button type="button" onClick={() => void runSync()} disabled={busy} className="btn btn-accent">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
              Sinkronkan sekarang
            </button>
          </div>
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className={`rounded-md border px-3.5 py-2.5 text-[0.8125rem] ${
            message.tone === "ok"
              ? "border-grove-100 bg-grove-100 text-grove-700"
              : message.tone === "warn"
                ? "border-caution-100 bg-caution-100 text-caution-700"
                : "border-alert-100 bg-alert-100 text-alert-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {lastRun ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="panel px-3.5 py-3">
            <p className="label-xs">Tersinkron</p>
            <p className="num mt-1 text-[1.25rem] font-semibold text-grove-700">{lastRun.synced}</p>
          </div>
          <div className="panel px-3.5 py-3">
            <p className="label-xs">Sudah pernah masuk</p>
            <p className="num mt-1 text-[1.25rem] font-semibold">{lastRun.alreadySynced}</p>
          </div>
          <div className="panel px-3.5 py-3">
            <p className="label-xs">Ditolak</p>
            <p className="num mt-1 text-[1.25rem] font-semibold text-alert-700">{lastRun.rejected}</p>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <div className="border-b border-ink-100 px-4 py-3">
          <h2 className="text-[0.9375rem] font-semibold">Antrean transaksi perangkat ini</h2>
          <p className="mt-0.5 text-[0.8125rem] text-ink-500">
            Setiap struk membawa <span className="num">client_request_id</span> unik, jadi pengiriman ganda tidak akan
            memotong stok dua kali.
          </p>
        </div>

        {outbox.length === 0 ? (
          <div className="px-4 py-8">
            <p className="text-[0.875rem] font-medium">Tidak ada antrean di perangkat ini</p>
            <p className="mt-1 max-w-[62ch] text-[0.8125rem] text-ink-500">
              Transaksi yang dibuat saat mode offline otomatis masuk ke sini dan hilang setelah server mengonfirmasi.
            </p>
            <Link href="/pos" className="btn btn-ghost mt-3">
              Kembali ke terminal
            </Link>
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Waktu dibuat</th>
                  <th>Item</th>
                  <th className="text-right">Total luring</th>
                  <th>Bayar</th>
                  <th>Percobaan</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((sale) => (
                  <tr key={sale.clientRequestId}>
                    <td className="num text-[0.8125rem]">{formatDateTime(sale.createdAt)}</td>
                    <td>
                      <span className="block text-[0.8125rem]">{sale.items.length} baris</span>
                      <span className="num block text-[0.6875rem] text-ink-500">
                        {sale.items.reduce((sum, item) => sum + item.qty, 0)} unit
                      </span>
                    </td>
                    <td className="num text-right text-[0.8125rem] font-medium">{formatIdr(sale.clientTotal)}</td>
                    <td>
                      <Badge tone="neutral">{sale.paymentMethod.replace(/_/g, " ")}</Badge>
                    </td>
                    <td>
                      <span className="num text-[0.8125rem]">{sale.attempts}</span>
                      {sale.lastError ? (
                        <span className="block max-w-[22ch] truncate text-[0.6875rem] text-alert-700">{sale.lastError}</span>
                      ) : null}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          await offlineDb.clearOutboxEntry(sale.clientRequestId);
                          await reload();
                        }}
                        className="btn-quiet"
                        aria-label="Hapus dari antrean"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="border-b border-ink-100 px-4 py-3">
          <h2 className="text-[0.9375rem] font-semibold">Riwayat sinkronisasi perangkat</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-[0.8125rem] text-ink-500">Belum ada riwayat sinkronisasi di perangkat ini.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {history.slice(0, 20).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {entry.status === "SYNCED" ? (
                    <Check size={14} className="text-grove-600" />
                  ) : entry.status === "ALREADY_SYNCED" ? (
                    <Check size={14} className="text-signal-700" />
                  ) : (
                    <CircleAlert size={14} className="text-caution-700" />
                  )}
                  <span className="num text-[0.8125rem]">{entry.receiptNumber ?? entry.clientRequestId.slice(0, 12)}</span>
                  <Badge tone={entry.status === "SYNCED" ? "grove" : entry.status === "ALREADY_SYNCED" ? "signal" : "caution"}>
                    {entry.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <span className="num text-[0.75rem] text-ink-500">{formatDateTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
