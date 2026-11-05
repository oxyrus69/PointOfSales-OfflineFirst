/**
 * GET /api/pos/catalog-snapshot — the exact payload the till caches in
 * IndexedDB so it can trade with zero network calls afterwards.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/server/rbac";
import { listCatalog, listCategories } from "@/server/services/products";
import { listActivePromos } from "@/server/services/promos";
import { listCustomers } from "@/server/services/customers";
import { getStoreSettings } from "@/server/services/settings";
import { findOpenShift } from "@/server/services/shiftEngine";
import type { CatalogSnapshot } from "@/lib/offlineDb";
import { fail } from "@/server/services/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    const [products, categories, promos, customers, settings, shift] = await Promise.all([
      listCatalog({ limit: 2000 }),
      listCategories(),
      listActivePromos(),
      listCustomers({ limit: 500 }),
      getStoreSettings(),
      findOpenShift(user.id),
    ]);

    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

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

    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const failure = fail(error);
    return NextResponse.json(
      { ok: false, error: failure.code ?? "SNAPSHOT_FAILED", message: failure.error },
      { status: failure.status ?? 500 },
    );
  }
}
