import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, Stat, Badge, EmptyState, Money, SectionTabs } from "@/components/ui";
import { requirePageRole } from "@/server/rbac";
import { listCatalog, stockValueSummary } from "@/server/services/products";
import { listOpnames, listPurchaseReceipts, listStockLedgers } from "@/server/services/inventoryEngine";
import { formatDateTime, formatIdr, toNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Inventaris" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/inventory", label: "Ringkasan" },
  { href: "/inventory/receiving", label: "Stok masuk" },
  { href: "/inventory/opname", label: "Stock opname" },
];

export default async function InventoryPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
  const [summary, products, receipts, opnames, ledger] = await Promise.all([
    stockValueSummary(),
    listCatalog({ includeInactive: false, limit: 400 }),
    listPurchaseReceipts(8),
    listOpnames(6),
    listStockLedgers({ limit: 24 }),
  ]);

  const low = products.filter((product) => product.stockOnHand <= product.reorderPoint);
  const capitalLocked = products.reduce((sum, product) => sum + product.stockOnHand * product.costPrice, 0);
  const reorderCapital = low.reduce((sum, product) => sum + Math.max(product.reorderQty, product.reorderPoint - product.stockOnHand) * product.costPrice, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Gudang & stok"
        title="Inventaris dan kartu stok"
        description="Semua perubahan kuantitas lewat satu pintu: ledger mencatat sebelum dan sesudah, sehingga selisih selalu bisa ditelusuri ke dokumen asal."
        actions={
          <Link href="/inventory/receiving" className="btn btn-primary">
            Terima barang
          </Link>
        }
      />

      <SectionTabs items={TABS} active="/inventory" />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Nilai stok (HPP)" value={<Money value={summary.totalCostValue} />} hint={`${summary.totalUnits} unit di rak`} />
        <Stat label="Nilai jual potensial" value={<Money value={summary.totalRetailValue} />} hint="Bila semua terjual di harga eceran" />
        <Stat label="Perlu restock" value={summary.lowStockCount} tone={summary.lowStockCount ? "caution" : "grove"} hint={`Estimasi modal ${formatIdr(reorderCapital)}`} />
        <Stat label="Produk aktif" value={summary.productCount} hint="Tidak termasuk produk nonaktif" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-4">
          <Panel
            title="Produk di bawah titik pesan ulang"
            description={low.length ? "Urutkan pembelian berdasarkan modal yang dibutuhkan" : "Semua produk di atas ambang aman"}
            flush
          >
            {low.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState title="Stok aman" description="Tidak ada produk yang menyentuh titik pesan ulang." />
              </div>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th className="text-right">Stok</th>
                      <th className="text-right">Titik pesan</th>
                      <th className="text-right">Saran pesan</th>
                      <th className="text-right">Estimasi modal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {low.map((product) => {
                      const suggested = Math.max(product.reorderQty, product.reorderPoint - product.stockOnHand, 1);
                      return (
                        <tr key={product.id}>
                          <td>
                            <span className="block text-[0.8125rem]">{product.name}</span>
                            <span className="num block text-[0.6875rem] text-ink-500">{product.sku}</span>
                          </td>
                          <td className="num text-right text-[0.8125rem] font-medium text-caution-700">{product.stockOnHand}</td>
                          <td className="num text-right text-[0.8125rem]">{product.reorderPoint}</td>
                          <td className="num text-right text-[0.8125rem]">{suggested}</td>
                          <td className="num text-right text-[0.8125rem]">{formatIdr(suggested * product.costPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Kartu stok terbaru" description="Immutable ledger: qty sebelum → sesudah" flush>
            <div className="scroll-thin max-h-[28rem] overflow-y-auto">
              <table className="data-table">
                <thead className="sticky top-0 bg-paper">
                  <tr>
                    <th>Waktu</th>
                    <th>Produk</th>
                    <th>Jenis</th>
                    <th>Referensi</th>
                    <th className="text-right">Perubahan</th>
                    <th className="text-right">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.id}>
                      <td className="num text-[0.75rem] text-ink-600">{formatDateTime(row.createdAt)}</td>
                      <td className="text-[0.8125rem]">{row.productName ?? "-"}</td>
                      <td>
                        <Badge tone={row.qtyChange < 0 ? "alert" : "grove"}>{row.movementType.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="num text-[0.6875rem] text-ink-500">{row.referenceId}</td>
                      <td className={`num text-right text-[0.8125rem] font-medium ${row.qtyChange < 0 ? "text-alert-700" : "text-grove-700"}`}>
                        {row.qtyChange > 0 ? "+" : ""}
                        {row.qtyChange}
                      </td>
                      <td className="num text-right text-[0.8125rem]">{row.qtyAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Penerimaan terakhir" flush>
            {receipts.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Belum ada penerimaan barang.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {receipts.map((receipt) => (
                  <li key={receipt.id} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[0.8125rem] font-medium">{receipt.receiptNumber}</span>
                      <span className="num text-[0.8125rem]">{formatIdr(receipt.totalAmount)}</span>
                    </div>
                    <p className="text-[0.6875rem] text-ink-500">
                      {receipt.supplierName ?? "tanpa supplier"} · {formatDateTime(receipt.receivedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Stock opname" description="Dokumen butuh persetujuan manajer" flush>
            {opnames.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Belum ada opname.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {opnames.map((opname) => (
                  <li key={opname.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <p className="num text-[0.8125rem] font-medium">{opname.opnameNumber}</p>
                      <p className="num text-[0.6875rem] text-ink-500">{formatDateTime(opname.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <Badge tone={opname.status === "APPROVED" ? "grove" : opname.status === "REJECTED" ? "alert" : "signal"}>
                        {opname.status}
                      </Badge>
                      <p className="num mt-0.5 text-[0.6875rem] text-ink-500">{formatIdr(opname.totalVarianceValue)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Modal mengendap">
            <p className="num text-[1.5rem] font-semibold leading-none">{formatIdr(capitalLocked)}</p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-500">
              Total modal yang tertanam di stok saat ini. Bila angka ini naik sementara penjualan datar, DSS akan
              menandai produk yang berubah menjadi dead stock.
            </p>
            <Link href="/dss" className="btn btn-ghost mt-2.5 w-full">
              Lihat rekomendasi DSS
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
