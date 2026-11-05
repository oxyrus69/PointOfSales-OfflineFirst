import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Badge, KeyValue, Money } from "@/components/ui";
import { ProductForm } from "@/components/product-form";
import { requirePageRole } from "@/server/rbac";
import { getProductById, listCategories, recentStockLedger } from "@/server/services/products";
import { formatDateTime, formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "Kelola Produk" };
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
  const product = await getProductById(id);
  if (!product) notFound();

  const [categories, ledger] = await Promise.all([listCategories(), recentStockLedger(id, 12)]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Katalog"
        title={product.name}
        description={`${product.sku} · ${product.categoryName ?? "tanpa kategori"} · stok ${product.stockOnHand} ${product.unit}`}
        actions={
          <Link href="/products" className="btn btn-ghost">
            Kembali
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Data produk & harga" description="Perubahan harga eceran langsung berlaku di terminal pada sinkronisasi berikutnya">
          <ProductForm
            categories={categories.map((category) => ({ id: category.id, name: category.name }))}
            product={{
              id: product.id,
              sku: product.sku,
              barcode: product.barcode,
              name: product.name,
              categoryId: product.categoryId,
              unit: product.unit,
              costPrice: product.costPrice,
              retailPrice: product.retailPrice,
              minMarginPct: product.minMarginPct,
              reorderPoint: product.reorderPoint,
              reorderQty: product.reorderQty,
              isTaxable: product.isTaxable,
              isActive: product.isActive,
              tiers: product.tiers.map((tier) => ({
                minQty: tier.minQty,
                tierUnitPrice: tier.tierUnitPrice,
                label: tier.label,
              })),
            }}
          />
        </Panel>

        <div className="space-y-4">
          <Panel title="Ringkasan">
            <KeyValue
              items={[
                { label: "Stok", value: `${product.stockOnHand} ${product.unit}` },
                { label: "Titik pesan ulang", value: `${product.reorderPoint} unit` },
                { label: "Jumlah pesan ulang", value: `${product.reorderQty} unit` },
                { label: "HPP", value: <Money value={product.costPrice} /> },
                { label: "Harga eceran", value: <Money value={product.retailPrice} /> },
                { label: "Nilai stok (HPP)", value: <Money value={product.stockOnHand * product.costPrice} /> },
                { label: "Versi data", value: product.version },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
              <Badge tone={product.isActive ? "grove" : "neutral"}>{product.isActive ? "aktif" : "nonaktif"}</Badge>
              <Badge tone={product.isTaxable ? "signal" : "neutral"}>{product.isTaxable ? "kena PPN" : "tanpa PPN"}</Badge>
              {product.stockOnHand <= product.reorderPoint ? <Badge tone="caution">perlu restock</Badge> : null}
            </div>
          </Panel>

          <Panel title="Kartu stok terakhir" description="Ledger tak terbantahkan: setiap perubahan tercatat" flush>
            {ledger.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Belum ada pergerakan stok.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {ledger.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-[0.75rem] font-medium">{row.movementType.replace(/_/g, " ")}</p>
                      <p className="num text-[0.6875rem] text-ink-500">
                        {row.referenceId} · {formatDateTime(row.createdAt)}
                      </p>
                    </div>
                    <span className={`num shrink-0 text-[0.8125rem] font-medium ${row.qtyChange < 0 ? "text-alert-700" : "text-grove-700"}`}>
                      {row.qtyChange > 0 ? "+" : ""}
                      {row.qtyChange}
                      <span className="block text-right text-[0.625rem] text-ink-500">→ {row.qtyAfter}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {product.tiers.length ? (
            <Panel title="Tabel harga grosir">
              <ul className="space-y-1.5 text-[0.8125rem]">
                {product.tiers.map((tier) => (
                  <li key={tier.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      ≥ {tier.minQty} unit · {tier.label}
                    </span>
                    <span className="num font-medium">{formatIdr(tier.tierUnitPrice)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
