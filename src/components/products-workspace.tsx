"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge, Money, PageHeader, Stat } from "@/components/ui";
import { EnterpriseDataGrid, type GridColumn, type GridFacet } from "@/components/data-grid";
import { computeMarginPct } from "@/lib/posMath";
import { formatIdr, formatPct } from "@/lib/format";

export type CatalogRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryName: string | null;
  unit: string;
  costPrice: number;
  retailPrice: number;
  minMarginPct: number;
  stockOnHand: number;
  reorderPoint: number;
  isActive: boolean;
  tiers: { id: string; minQty: number; tierUnitPrice: number; label: string }[];
};

export function ProductsWorkspace({
  products,
  categories,
  summary,
  search,
  categoryId,
}: {
  products: CatalogRow[];
  categories: { id: string; name: string }[];
  summary: { totalCostValue: number; totalUnits: number; productCount: number; lowStockCount: number };
  search: string;
  categoryId: string;
}) {
  const initialCategory = categories.find((category) => category.id === categoryId)?.name ?? "all";

  const facets: GridFacet[] = useMemo(
    () => [
      { key: "all", label: "Semua", count: products.length },
      ...categories.map((category) => ({
        key: category.name,
        label: category.name,
        count: products.filter((product) => product.categoryName === category.name).length,
      })),
    ],
    [categories, products],
  );

  const belowMargin = products.filter(
    (product) => product.minMarginPct > 0 && computeMarginPct(product.retailPrice, product.costPrice) < product.minMarginPct,
  );

  const columns: GridColumn<CatalogRow>[] = [
    {
      key: "sku",
      header: "SKU / Barcode",
      sortValue: (row) => row.sku,
      render: (row) => (
        <span className="block">
          <span className="num block text-[0.75rem] font-medium">{row.sku}</span>
          <span className="num block text-[0.6875rem] text-ink-500">{row.barcode ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "name",
      header: "Nama",
      sortValue: (row) => row.name,
      render: (row) => (
        <span className="block max-w-[22ch]">
          <span className="block truncate text-[0.75rem]">{row.name}</span>
          {row.tiers.length ? <span className="tag tag-accent mt-0.5">{row.tiers.length} tier grosir</span> : null}
        </span>
      ),
    },
    {
      key: "category",
      header: "Kategori",
      sortValue: (row) => row.categoryName ?? "",
      render: (row) => <span className="text-[0.75rem] text-ink-600">{row.categoryName ?? "—"}</span>,
    },
    {
      key: "cost",
      header: "HPP",
      numeric: true,
      sortValue: (row) => row.costPrice,
      render: (row) => <span className="num text-[0.75rem]">{formatIdr(row.costPrice)}</span>,
    },
    {
      key: "retail",
      header: "Eceran",
      numeric: true,
      sortValue: (row) => row.retailPrice,
      render: (row) => <span className="num text-[0.75rem]">{formatIdr(row.retailPrice)}</span>,
    },
    {
      key: "margin",
      header: "Margin",
      numeric: true,
      sortValue: (row) => computeMarginPct(row.retailPrice, row.costPrice),
      render: (row) => {
        const margin = computeMarginPct(row.retailPrice, row.costPrice);
        const under = row.minMarginPct > 0 && margin < row.minMarginPct;
        return (
          <span className={`num text-[0.75rem] ${under ? "font-medium text-alert-700" : ""}`}>
            {formatPct(margin)}
            {under ? <span className="block text-[0.625rem]">min {formatPct(row.minMarginPct)}</span> : null}
          </span>
        );
      },
    },
    {
      key: "stock",
      header: "Stok",
      numeric: true,
      sortValue: (row) => row.stockOnHand,
      render: (row) => (
        <span className={`num text-[0.75rem] ${row.stockOnHand <= row.reorderPoint ? "font-medium text-caution-700" : ""}`}>
          {row.stockOnHand}
          <span className="block text-[0.625rem] text-ink-500">min {row.reorderPoint}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => (row.isActive ? "aktif" : "nonaktif"),
      render: (row) => <Badge tone={row.isActive ? "grove" : "neutral"}>{row.isActive ? "aktif" : "nonaktif"}</Badge>,
    },
    {
      key: "action",
      header: "",
      render: (row) => (
        <Link href={`/products/${row.id}`} className="btn btn-ghost h-6 py-0 text-[0.6875rem]">
          Kelola
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Katalog"
        title="Produk dan harga bertingkat"
        description="Harga grosir berlaku otomatis saat kuantitas menyentuh ambang tier. HPP adalah rata-rata tertimbang dari penerimaan barang."
        meta={<Badge tone="neutral">{products.length} produk</Badge>}
        actions={
          <>
            <form action="/products" className="flex flex-wrap items-end gap-1.5">
              <label className="block">
                <span className="label-xs">Cari</span>
                <input name="q" defaultValue={search} className="field field-mono mt-1 h-8 py-0 text-[0.8125rem]" placeholder="SKU / nama" />
              </label>
              <button type="submit" className="btn btn-primary h-8 py-0 text-[0.8125rem]">
                Cari
              </button>
            </form>
            <Link href="/inventory/receiving" className="btn btn-primary h-8 py-0 text-[0.8125rem]">
              Terima barang
            </Link>
          </>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Produk aktif" value={products.filter((product) => product.isActive).length} hint={`${products.length} total termasuk nonaktif`} />
        <Stat label="Nilai stok (HPP)" value={<Money value={summary.totalCostValue} />} hint={`${summary.totalUnits} unit di rak`} />
        <Stat label="Aturan harga grosir" value={products.filter((product) => product.tiers.length > 0).length} hint="Produk punya minimal satu tier" tone="signal" />
        <Stat label="Margin di bawah batas" value={belowMargin.length} tone={belowMargin.length ? "alert" : "grove"} hint="Perlu penyesuaian harga jual" />
      </div>

      <EnterpriseDataGrid
        rows={products}
        columns={columns}
        facets={facets}
        activeFacet={initialCategory}
        facetKey={(row) => row.categoryName ?? ""}
        caption="Katalog produk"
        emptyState={<p className="text-[0.8125rem] text-ink-500">Tidak ada produk pada filter ini.</p>}
      />
    </div>
  );
}
