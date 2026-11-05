import type { Metadata } from "next";
import { ProductsWorkspace } from "@/components/products-workspace";
import { requirePageRole } from "@/server/rbac";
import { listCatalog, listCategories, stockValueSummary } from "@/server/services/products";
import { sanitizeText, sanitizeUuid } from "@/lib/params";

export const metadata: Metadata = { title: "Produk" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
  const params = await searchParams;
  const search = sanitizeText(params.q, 60);
  const categoryId = sanitizeUuid(params.category);

  const [products, categories, summary] = await Promise.all([
    listCatalog({ search, categoryId, includeInactive: true, limit: 400 }),
    listCategories(),
    stockValueSummary(),
  ]);

  return (
    <ProductsWorkspace
      products={products.map((product) => ({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        categoryName: product.categoryName,
        unit: product.unit,
        costPrice: product.costPrice,
        retailPrice: product.retailPrice,
        minMarginPct: product.minMarginPct,
        stockOnHand: product.stockOnHand,
        reorderPoint: product.reorderPoint,
        isActive: product.isActive,
        tiers: product.tiers.map((tier) => ({
          id: tier.id,
          minQty: tier.minQty,
          tierUnitPrice: tier.tierUnitPrice,
          label: tier.label,
        })),
      }))}
      categories={categories.map((category) => ({ id: category.id, name: category.name }))}
      summary={summary}
      search={search}
      categoryId={categoryId ?? ""}
    />
  );
}
