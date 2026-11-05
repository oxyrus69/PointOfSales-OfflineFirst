import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  categories,
  productPriceTiers,
  products,
  salesOrderItems,
  salesOrders,
  stockLedgers,
  type Product,
} from "@/server/db/schema";
import { moneyString, toInt, toNumber } from "@/lib/format";

export type CatalogProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  costPrice: number;
  retailPrice: number;
  minMarginPct: number;
  stockOnHand: number;
  reorderPoint: number;
  reorderQty: number;
  isTaxable: boolean;
  isActive: boolean;
  version: number;
  tiers: { id: string; minQty: number; tierUnitPrice: number; label: string }[];
};

export async function listCatalog(options?: {
  search?: string;
  categoryId?: string;
  includeInactive?: boolean;
  limit?: number;
}): Promise<CatalogProduct[]> {
  const db = await getDb();
  const conditions: SQL[] = [];
  if (!options?.includeInactive) conditions.push(eq(products.isActive, true));
  if (options?.categoryId) conditions.push(eq(products.categoryId, options.categoryId));
  const search = options?.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const searchClause = or(
      ilike(products.name, pattern),
      ilike(products.sku, pattern),
      ilike(products.barcode, pattern),
    );
    if (searchClause) conditions.push(searchClause);
  }

  const rows = await db
    .select({
      product: products,
      categoryName: categories.name,
      tierId: productPriceTiers.id,
      tierMinQty: productPriceTiers.minQty,
      tierUnitPrice: productPriceTiers.tierUnitPrice,
      tierLabel: productPriceTiers.label,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(productPriceTiers, eq(productPriceTiers.productId, products.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(products.name), asc(productPriceTiers.minQty))
    .limit(options?.limit ?? 400);

  const byId = new Map<string, CatalogProduct>();
  for (const row of rows) {
    let entry = byId.get(row.product.id);
    if (!entry) {
      entry = {
        id: row.product.id,
        sku: row.product.sku,
        barcode: row.product.barcode,
        name: row.product.name,
        categoryId: row.product.categoryId,
        categoryName: row.categoryName ?? null,
        unit: row.product.unit,
        costPrice: toNumber(row.product.costPrice),
        retailPrice: toNumber(row.product.retailPrice),
        minMarginPct: toNumber(row.product.minMarginPct),
        stockOnHand: row.product.stockOnHand,
        reorderPoint: row.product.reorderPoint,
        reorderQty: row.product.reorderQty,
        isTaxable: row.product.isTaxable,
        isActive: row.product.isActive,
        version: row.product.version,
        tiers: [],
      };
      byId.set(row.product.id, entry);
    }
    if (row.tierId && row.tierMinQty !== null && row.tierUnitPrice !== null) {
      entry.tiers.push({
        id: row.tierId,
        minQty: row.tierMinQty,
        tierUnitPrice: toNumber(row.tierUnitPrice),
        label: row.tierLabel ?? "Grosir",
      });
    }
  }
  return Array.from(byId.values());
}

export async function getProductById(productId: string): Promise<CatalogProduct | null> {
  const list = await listCatalog({ limit: 1 });
  const direct = list.find((item) => item.id === productId);
  if (direct) return direct;
  const db = await getDb();
  const [row] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) return null;
  const results = await listCatalog({ includeInactive: true, limit: 1000 });
  return results.find((item) => item.id === productId) ?? null;
}

export async function findByBarcode(barcode: string): Promise<CatalogProduct | null> {
  const code = barcode.trim();
  if (!code) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(or(eq(products.barcode, code), eq(products.sku, code)))
    .limit(1);
  if (!row) return null;
  const all = await listCatalog({ includeInactive: true, limit: 1000 });
  return all.find((item) => item.id === row.id) ?? null;
}

export async function listCategories() {
  const db = await getDb();
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function upsertProduct(input: {
  id?: string;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId?: string | null;
  unit?: string;
  costPrice: number;
  retailPrice: number;
  minMarginPct?: number;
  reorderPoint?: number;
  reorderQty?: number;
  isTaxable?: boolean;
  isActive?: boolean;
  actorId: string;
  tiers?: { minQty: number; tierUnitPrice: number; label: string }[];
}): Promise<Product> {
  const db = await getDb();
  const payload = {
    sku: input.sku.trim(),
    barcode: input.barcode?.trim() || null,
    name: input.name.trim(),
    categoryId: input.categoryId ?? null,
    unit: (input.unit ?? "PCS").trim().toUpperCase(),
    costPrice: moneyString(input.costPrice),
    retailPrice: moneyString(input.retailPrice),
    minMarginPct: moneyString(input.minMarginPct ?? 0),
    reorderPoint: toInt(input.reorderPoint ?? 0),
    reorderQty: toInt(input.reorderQty ?? 0),
    isTaxable: input.isTaxable ?? true,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };

  let saved: Product;
  if (input.id) {
    const [row] = await db
      .update(products)
      .set({ ...payload, version: sql`${products.version} + 1` })
      .where(eq(products.id, input.id))
      .returning();
    saved = row;
  } else {
    const [row] = await db.insert(products).values(payload).returning();
    saved = row;
  }

  if (input.tiers) {
    await db.delete(productPriceTiers).where(eq(productPriceTiers.productId, saved.id));
    if (input.tiers.length) {
      await db.insert(productPriceTiers).values(
        input.tiers
          .filter((tier) => tier.minQty > 0 && tier.tierUnitPrice > 0)
          .map((tier) => ({
            productId: saved.id,
            minQty: toInt(tier.minQty),
            tierUnitPrice: moneyString(tier.tierUnitPrice),
            label: tier.label.trim() || `Grosir ${tier.minQty}+`,
          })),
      );
    }
  }

  return saved;
}

export async function lowStockProducts(limit = 20) {
  const db = await getDb();
  return db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      stockOnHand: products.stockOnHand,
      reorderPoint: products.reorderPoint,
      reorderQty: products.reorderQty,
      costPrice: products.costPrice,
    })
    .from(products)
    .where(and(eq(products.isActive, true), sql`${products.stockOnHand} <= ${products.reorderPoint}`))
    .orderBy(asc(products.stockOnHand))
    .limit(limit);
}

/** Unit velocity over the trailing window, from sold quantities. */
export async function salesVelocityByProduct(days = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  return db
    .select({
      productId: salesOrderItems.productId,
      qtySold: sql<string>`coalesce(sum(${salesOrderItems.qty} - ${salesOrderItems.refundedQty}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineSubtotal}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesOrderItems.unitCogsSnapshot} * ${salesOrderItems.qty}), 0)`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, since)))
    .groupBy(salesOrderItems.productId);
}

export async function recentStockLedger(productId: string, limit = 60) {
  const db = await getDb();
  return db
    .select()
    .from(stockLedgers)
    .where(eq(stockLedgers.productId, productId))
    .orderBy(desc(stockLedgers.createdAt))
    .limit(limit);
}

export async function stockValueSummary() {
  const db = await getDb();
  const [row] = await db
    .select({
      productCount: sql<string>`count(*)`,
      totalUnits: sql<string>`coalesce(sum(${products.stockOnHand}), 0)`,
      totalCostValue: sql<string>`coalesce(sum(${products.stockOnHand} * ${products.costPrice}), 0)`,
      totalRetailValue: sql<string>`coalesce(sum(${products.stockOnHand} * ${products.retailPrice}), 0)`,
      lowStockCount: sql<string>`count(*) filter (where ${products.stockOnHand} <= ${products.reorderPoint})`,
    })
    .from(products)
    .where(eq(products.isActive, true));
  return {
    productCount: toInt(row?.productCount ?? 0),
    totalUnits: toInt(row?.totalUnits ?? 0),
    totalCostValue: toNumber(row?.totalCostValue ?? 0),
    totalRetailValue: toNumber(row?.totalRetailValue ?? 0),
    lowStockCount: toInt(row?.lowStockCount ?? 0),
  };
}

export async function productsReceivedRecently(days = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  return db
    .select({
      productId: stockLedgers.productId,
      qty: sql<string>`coalesce(sum(${stockLedgers.qtyChange}), 0)`,
      lastCost: sql<string>`coalesce(max(${stockLedgers.unitCostAtMovement}), 0)`,
    })
    .from(stockLedgers)
    .where(and(eq(stockLedgers.movementType, "PURCHASE_RECEIVE"), gte(stockLedgers.createdAt, since)))
    .groupBy(stockLedgers.productId);
}
