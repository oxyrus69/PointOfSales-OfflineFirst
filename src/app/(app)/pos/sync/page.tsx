import type { Metadata } from "next";
import { SyncCenter } from "@/components/sync-center";
import { PageHeader, Panel, Badge, EmptyState, Money } from "@/components/ui";
import { requirePageRole } from "@/server/rbac";
import { listSyncConflicts } from "@/server/services/posSyncEngine";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Sinkronisasi" };
export const dynamic = "force-dynamic";

export default async function PosSyncPage() {
  const user = await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
  const canResolve = user.role !== "CASHIER";
  const conflicts = await listSyncConflicts({ includeResolved: false, limit: 30 });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Pusat sinkronisasi"
        title="Antrean luring & konflik stok"
        description="Terminal mengirim struk luring secara idempoten. Bila stok server ternyata lebih kecil dari yang terjual, transaksi tetap diterima dan konflik dicatat di sini untuk direkonsiliasi manajer."
        actions={
          <Badge tone={conflicts.length ? "caution" : "grove"}>
            {conflicts.length ? `${conflicts.length} konflik terbuka` : "Tidak ada konflik"}
          </Badge>
        }
      />

      <SyncCenter cashierId={user.id} />

      <Panel
        title="Konflik stok offline"
        description="Stok fisik dan uang sudah berpindah tangan di kasir. Sistem tidak menolak transaksi; sistem menandai selisihnya."
        flush
      >
        {conflicts.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              title="Semua sinkronisasi bersih"
              description="Tidak ada transaksi offline yang membuat stok server negatif."
            />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Struk</th>
                  <th>Produk</th>
                  <th className="text-right">Stok server sebelum</th>
                  <th className="text-right">Terjual offline</th>
                  <th>Dibuat</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((conflict) => (
                  <tr key={conflict.id}>
                    <td className="num text-[0.8125rem]">{conflict.receiptNumber ?? conflict.clientRequestId.slice(0, 12)}</td>
                    <td>
                      <span className="block text-[0.8125rem]">{conflict.productName ?? "-"}</span>
                      <span className="num block text-[0.6875rem] text-ink-500">{conflict.sku ?? "-"}</span>
                    </td>
                    <td className="num text-right text-[0.8125rem]">{conflict.serverQtyBefore}</td>
                    <td className="num text-right text-[0.8125rem] font-medium text-alert-700">{conflict.offlineQtySold}</td>
                    <td className="num text-[0.8125rem]">{formatDateTime(conflict.createdAt)}</td>
                    <td>
                      <Badge tone="caution">{canResolve ? "perlu rekonsiliasi" : "menunggu manajer"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Cara sistem menjaga angka tetap benar" description="Tiga lapis pertahanan yang berjalan otomatis">
        <ol className="space-y-3 text-[0.8125rem] leading-relaxed text-ink-700">
          <li className="flex gap-2.5">
            <span className="num shrink-0 text-ink-400">01</span>
            <span>
              <strong className="font-semibold text-ink-900">Idempoten per struk.</strong> Setiap transaksi membawa{" "}
              <span className="num">client_request_id</span>. Bila batch terkirim dua kali, server mengembalikan{" "}
              <span className="num">ALREADY_SYNCED</span> tanpa memotong stok lagi.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="num shrink-0 text-ink-400">02</span>
            <span>
              <strong className="font-semibold text-ink-900">Hitung ulang di server.</strong> Harga grosir, diskon
              berlapis, PPN, dan pembulatan dihitung ulang dari master data. Selisih di atas toleransi dicatat sebagai
              peringatan audit.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="num shrink-0 text-ink-400">03</span>
            <span>
              <strong className="font-semibold text-ink-900">Stok negatif bukan alasan menolak uang.</strong> Bila stok
              server lebih kecil, penjualan tetap sah dan baris konflik dibuat agar manajer dapat melakukan opname
              korektif.
            </span>
          </li>
        </ol>
      </Panel>
    </div>
  );
}
