import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  categories,
  offlineSyncConflicts,
  posShifts,
  products,
  profiles,
  salesOrderItems,
  salesOrders,
  stockLedgers,
} from "@/server/db/schema";
import { toNumber } from "@/lib/format";

export type DailyPoint = { date: string; label: string; net: number; orders: number };

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function salesTrend(days = 14): Promise<DailyPoint[]> {
  const db = await getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${salesOrders.createdAt}), 'YYYY-MM-DD')`,
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      orders: sql<string>`count(*)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, start)))
    .groupBy(sql`date_trunc('day', ${salesOrders.createdAt})`);

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: DailyPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    const row = byDay.get(key);
    points.push({
      date: key,
      label: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`,
      net: toNumber(row?.net),
      orders: Number(row?.orders ?? 0),
    });
  }
  return points;
}

export async function dashboardSummary() {
  const db = await getDb();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today] = await db
    .select({
      orders: sql<string>`count(*)`,
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesOrders.totalCogs}), 0)`,
      tax: sql<string>`coalesce(sum(${salesOrders.taxAmount}), 0)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, todayStart)));

  const [month] = await db
    .select({
      orders: sql<string>`count(*)`,
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesOrders.totalCogs}), 0)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, monthStart)));

  const [inventory] = await db
    .select({
      units: sql<string>`coalesce(sum(${products.stockOnHand}), 0)`,
      costValue: sql<string>`coalesce(sum(${products.stockOnHand} * ${products.costPrice}), 0)`,
      lowStock: sql<string>`count(*) filter (where ${products.stockOnHand} <= ${products.reorderPoint})`,
      productCount: sql<string>`count(*)`,
    })
    .from(products)
    .where(eq(products.isActive, true));

  const [openShift] = await db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      openingCash: posShifts.openingCash,
      openedAt: posShifts.openedAt,
      cashierName: profiles.fullName,
      terminalId: posShifts.terminalId,
    })
    .from(posShifts)
    .leftJoin(profiles, eq(profiles.id, posShifts.cashierId))
    .where(eq(posShifts.status, "OPEN"))
    .orderBy(desc(posShifts.openedAt))
    .limit(1);

  const [conflicts] = await db
    .select({ count: sql<string>`count(*)` })
    .from(offlineSyncConflicts)
    .where(eq(offlineSyncConflicts.resolved, false));

  const [voids] = await db
    .select({ count: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)` })
    .from(salesOrders)
    .where(and(eq(salesOrders.status, "VOIDED"), gte(salesOrders.createdAt, monthStart)));

  const todayNet = toNumber(today?.net);
  const todayCogs = toNumber(today?.cogs);
  const monthNet = toNumber(month?.net);
  const monthCogs = toNumber(month?.cogs);

  return {
    today: {
      orders: Number(today?.orders ?? 0),
      net: todayNet,
      cogs: todayCogs,
      tax: toNumber(today?.tax),
      grossProfit: todayNet - toNumber(today?.tax) - todayCogs,
    },
    month: {
      orders: Number(month?.orders ?? 0),
      net: monthNet,
      grossProfit: monthNet - monthCogs,
    },
    inventory: {
      units: Number(inventory?.units ?? 0),
      costValue: toNumber(inventory?.costValue),
      lowStock: Number(inventory?.lowStock ?? 0),
      productCount: Number(inventory?.productCount ?? 0),
    },
    openShift: openShift ?? null,
    unresolvedConflicts: Number(conflicts?.count ?? 0),
    voidsThisMonth: { count: Number(voids?.count ?? 0), amount: toNumber(voids?.amount) },
  };
}

export async function topSellingProducts(days = 30, limit = 8) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      productId: salesOrderItems.productId,
      name: products.name,
      sku: products.sku,
      qty: sql<string>`coalesce(sum(${salesOrderItems.qty} - ${salesOrderItems.refundedQty}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineSubtotal}), 0)`,
      margin: sql<string>`coalesce(sum(${salesOrderItems.lineSubtotal} - ${salesOrderItems.unitCogsSnapshot} * ${salesOrderItems.qty}), 0)`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .leftJoin(products, eq(products.id, salesOrderItems.productId))
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, since)))
    .groupBy(salesOrderItems.productId, products.name, products.sku)
    .orderBy(sql`sum(${salesOrderItems.lineSubtotal}) desc`)
    .limit(limit);

  return rows.map((row) => ({
    productId: row.productId ?? "",
    name: row.name ?? "Produk terhapus",
    sku: row.sku ?? "-",
    qty: Number(row.qty ?? 0),
    revenue: toNumber(row.revenue),
    margin: toNumber(row.margin),
  }));
}

export async function paymentMix(days = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      method: salesOrders.paymentMethod,
      total: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, since)))
    .groupBy(salesOrders.paymentMethod);
  return rows.map((row) => ({
    method: row.method,
    total: toNumber(row.total),
    count: Number(row.count ?? 0),
  }));
}

export async function categoryPerformance(days = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      category: categories.name,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineSubtotal}), 0)`,
      qty: sql<string>`coalesce(sum(${salesOrderItems.qty}), 0)`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, since)))
    .groupBy(categories.name)
    .orderBy(sql`sum(${salesOrderItems.lineSubtotal}) desc`);
  return rows.map((row) => ({
    category: row.category ?? "Tanpa kategori",
    revenue: toNumber(row.revenue),
    qty: Number(row.qty ?? 0),
  }));
}

export async function shiftVarianceLeaderboard(limit = 6) {
  const db = await getDb();
  const rows = await db
    .select({
      shiftNumber: posShifts.shiftNumber,
      cashierName: profiles.fullName,
      closedAt: posShifts.closedAt,
      variance: posShifts.cashVariance,
      status: posShifts.status,
    })
    .from(posShifts)
    .leftJoin(profiles, eq(profiles.id, posShifts.cashierId))
    .where(sql`${posShifts.cashVariance} is not null and ${posShifts.cashVariance} <> 0`)
    .orderBy(sql`abs(${posShifts.cashVariance}) desc`)
    .limit(limit);
  return rows.map((row) => ({ ...row, variance: toNumber(row.variance) }));
}

export async function hourlySalesToday() {
  const db = await getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      hour: sql<string>`extract(hour from ${salesOrders.createdAt})`,
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
    })
    .from(salesOrders)
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, start)))
    .groupBy(sql`extract(hour from ${salesOrders.createdAt})`)
    .orderBy(sql`extract(hour from ${salesOrders.createdAt})`);

  const map = new Map(rows.map((row) => [Number(row.hour), toNumber(row.net)]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    net: map.get(hour) ?? 0,
  }));
}

export async function recentStockActivity(limit = 8) {
  const db = await getDb();
  return db
    .select({
      id: stockLedgers.id,
      productName: products.name,
      sku: products.sku,
      movementType: stockLedgers.movementType,
      qtyChange: stockLedgers.qtyChange,
      qtyAfter: stockLedgers.qtyAfter,
      referenceId: stockLedgers.referenceId,
      createdAt: stockLedgers.createdAt,
    })
    .from(stockLedgers)
    .leftJoin(products, eq(products.id, stockLedgers.productId))
    .orderBy(desc(stockLedgers.createdAt))
    .limit(limit);
}

export async function yesterdayComparison() {
  const db = await getDb();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);

  const [yesterday] = await db
    .select({
      net: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      orders: sql<string>`count(*)`,
    })
    .from(salesOrders)
    .where(
      and(
        sql`${salesOrders.status} <> 'VOIDED'`,
        gte(salesOrders.createdAt, startOfYesterday),
        lt(salesOrders.createdAt, startOfToday),
      ),
    );

  return { net: toNumber(yesterday?.net), orders: Number(yesterday?.orders ?? 0) };
}
