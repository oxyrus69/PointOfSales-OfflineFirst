import type { Metadata } from "next";
import { PageHeader, Panel, SectionTabs } from "@/components/ui";
import { ReceivingForm } from "@/components/inventory-forms";
import { requirePageRole } from "@/server/rbac";
import { listCatalog } from "@/server/services/products";
import { listPurchaseReceipts, listSuppliers } from "@/server/services/inventoryEngine";
import { formatDateTime, formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "Stok Masuk" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/inventory", label: "Ringkasan" },
  { href: "/inventory/receiving", label: "Stok masuk" },
  { href: "/inventory/opname", label: "Stock opname" },
];

export default async function ReceivingPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
  const [products, suppliers, receipts] = await Promise.all([
    listCatalog({ includeInactive: false, limit: 400 }),
    listSuppliers(),
    listPurchaseReceipts(12),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Penerimaan barang"
        title="Stok masuk & HPP rata-rata"
        description="Harga beli baru tidak menimpa HPP lama. Sistem menghitung ulang rata-rata tertimbang memakai kuantitas stok lama dan kuantitas yang baru masuk."
      />
      <SectionTabs items={TABS} active="/inventory/receiving" />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Dokumen penerimaan" description="Satu dokumen bisa berisi banyak produk dan harga beli berbeda">
          <ReceivingForm
            products={products.map((product) => ({
              id: product.id,
              name: product.name,
              sku: product.sku,
              stockOnHand: product.stockOnHand,
              costPrice: product.costPrice,
            }))}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
          />
        </Panel>

        <div className="space-y-4">
          <Panel title="Riwayat penerimaan" flush>
            {receipts.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Belum ada penerimaan.</p>
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
                    {receipt.notes ? <p className="mt-0.5 text-[0.6875rem] text-ink-500">{receipt.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Rumus HPP">
            <p className="text-[0.8125rem] leading-relaxed text-ink-700">
              HPP baru = ((stok lama × HPP lama) + (qty masuk × harga beli)) ÷ (stok lama + qty masuk)
            </p>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-500">
              Bila stok lama negatif akibat penjualan luring yang belum direkonsiliasi, bobot stok lama dihitung nol agar
              HPP tidak terdistorsi ke bawah.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
