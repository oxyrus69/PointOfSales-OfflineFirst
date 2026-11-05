import type { Metadata } from "next";
import { PosTerminal } from "@/components/pos-terminal";
import { requirePageRole } from "@/server/rbac";
import { findOpenShift } from "@/server/services/shiftEngine";
import { getStoreSettings } from "@/server/services/settings";
import { listCatalog, listCategories } from "@/server/services/products";
import { listActivePromos } from "@/server/services/promos";
import { listCustomers } from "@/server/services/customers";
import type { CatalogSnapshot } from "@/lib/offlineDb";

export const metadata: Metadata = { title: "Terminal Kasir" };
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const user = await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
  const [settings, shift, products, categories, promos, customers] = await Promise.all([
    getStoreSettings(),
    findOpenShift(user.id),
    listCatalog({ limit: 2000 }),
    listCategories(),
    listActivePromos(),
    listCustomers({ limit: 500 }),
  ]);

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  // Server-rendered bootstrap: identical shape to /api/pos/catalog-snapshot, so
  // the till can trade immediately even before the first background refresh.
  const snapshot: CatalogSnapshot = {
    id: "current",
    fetchedAt: new Date().toISOString(),
    terminalId: shift?.terminalId ?? "KASIR-01",
    products: products
      .filter((product) => product.isActive)
      .map((product) => ({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        unit: product.unit,
        categoryName: product.categoryId ? categoryNames.get(product.categoryId) ?? null : null,
        retailPrice: product.retailPrice,
        costPrice: product.costPrice,
        isTaxable: product.isTaxable,
        stockOnHand: product.stockOnHand,
        tiers: product.tiers.map((tier) => ({
          minQty: tier.minQty,
          tierUnitPrice: tier.tierUnitPrice,
          label: tier.label,
        })),
      })),
    customers: customers.map((customer) => ({
      id: customer.id,
      memberCode: customer.memberCode,
      name: customer.name,
      tier: customer.tier,
      discountPct: customer.discountPct,
    })),
    promos: promos.map((promo) => ({
      id: promo.id,
      code: promo.code,
      name: promo.name,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      minSubtotal: promo.minSubtotal,
      maxDiscountCap: promo.maxDiscountCap,
    })),
    settings: {
      storeName: settings.storeName,
      taxRatePct: settings.taxRatePct,
      priceIncludesTax: settings.priceIncludesTax,
      cashRoundingStep: settings.cashRoundingStep,
      cashierDiscountLimitPct: settings.cashierDiscountLimitPct,
    },
    shift: shift ? { id: shift.id, shiftNumber: shift.shiftNumber, terminalId: shift.terminalId } : null,
  };

  return (
    <PosTerminal
      initialSnapshot={snapshot}
      cashierId={user.id}
      cashierName={user.fullName}
      shiftId={shift?.id ?? null}
      shiftNumber={shift?.shiftNumber ?? null}
      terminalId={snapshot.terminalId}
      storeName={settings.storeName}
      taxRatePct={settings.taxRatePct}
      priceIncludesTax={settings.priceIncludesTax}
      cashRoundingStep={settings.cashRoundingStep}
      cashierDiscountLimitPct={settings.cashierDiscountLimitPct}
    />
  );
}
