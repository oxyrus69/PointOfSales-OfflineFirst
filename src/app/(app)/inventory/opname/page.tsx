import type { Metadata } from "next";
import { PageHeader, Panel, SectionTabs, Badge, StatusBadge } from "@/components/ui";
import { OpnameApproval, OpnameForm } from "@/components/inventory-forms";
import { requirePageRole } from "@/server/rbac";
import { listCatalog } from "@/server/services/products";
import { getOpnameDetail, listOpnames } from "@/server/services/inventoryEngine";
import { formatDateTime, formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "Stock Opname" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/inventory", label: "Ringkasan" },
  { href: "/inventory/receiving", label: "Stok masuk" },
  { href: "/inventory/opname", label: "Stock opname" },
];

export default async function OpnamePage() {
  const user = await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
  const [products, opnames] = await Promise.all([listCatalog({ includeInactive: false, limit: 400 }), listOpnames(8)]);
  const latest = opnames[0] ? await getOpnameDetail(opnames[0].id) : null;
  const canApprove = user.role === "SUPER_ADMIN" || user.role === "STORE_MANAGER";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Perhitungan fisik"
        title="Stock opname"
        description="Gudang menghitung fisik, manajer menyetujui. Stok sistem baru berubah setelah persetujuan, sehingga tidak ada penyesuaian liar tanpa bukti."
      />
      <SectionTabs items={TABS} active="/inventory/opname" />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Hitung fisik baru" description="Isi kuantitas nyata di rak, bukan selisih">
          <OpnameForm
            products={products.map((product) => ({
              id: product.id,
              name: product.name,
              sku: product.sku,
              stockOnHand: product.stockOnHand,
              costPrice: product.costPrice,
            }))}
          />
        </Panel>

        <div className="space-y-4">
          <Panel title="Dokumen terakhir" flush>
            {opnames.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Belum ada dokumen opname.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {opnames.map((opname) => (
                  <li key={opname.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <p className="num text-[0.8125rem] font-medium">{opname.opnameNumber}</p>
                      <p className="num text-[0.6875rem] text-ink-500">{formatDateTime(opname.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <StatusBadge value={opname.status} />
                      <p className="num mt-0.5 text-[0.6875rem] text-ink-500">{formatIdr(opname.totalVarianceValue)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {latest ? (
            <Panel title={`Persetujuan ${latest.opname.opnameNumber}`} description={latest.opname.notes ?? undefined}>
              <ul className="mb-3 divide-y divide-ink-100 text-[0.8125rem]">
                {latest.items.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      {item.productName} <span className="num text-[0.6875rem] text-ink-500">{item.sku}</span>
                    </span>
                    <span className="num shrink-0 text-right">
                      {item.systemQtySnapshot} → {item.physicalQtyCounted}
                      <span className={`ml-1.5 ${item.varianceQty < 0 ? "text-alert-700" : item.varianceQty > 0 ? "text-grove-700" : "text-ink-500"}`}>
                        ({item.varianceQty > 0 ? "+" : ""}
                        {item.varianceQty})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {canApprove ? <OpnameApproval opnameId={latest.opname.id} status={latest.opname.status} /> : (
                <Badge tone="caution">menunggu persetujuan manajer</Badge>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
