import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  decisionLogs,
  decisionRules,
  posShifts,
  products,
  profiles,
  salesOrderItems,
  salesOrders,
  type DecisionCategory,
} from "@/server/db/schema";
import { computeDaysOfStock, computeMarginPct, rupiah } from "@/lib/posMath";
import { toNumber } from "@/lib/format";
import { getStoreSettings } from "@/server/services/settings";

export type DssRecommendation = {
  ruleCode: DecisionCategory;
  subjectId: string;
  subjectLabel: string;
  severity: "info" | "warning" | "critical";
  headline: string;
  detail: string;
  metrics: { label: string; value: string }[];
  suggestedAction: string;
  payload: Record<string, unknown>;
};

export type DssReport = {
  generatedAt: string;
  restock: DssRecommendation[];
  deadStock: DssRecommendation[];
  marginErosion: DssRecommendation[];
  cashierRisk: DssRecommendation[];
  totals: {
    urgentRestockCount: number;
    restockCapitalNeeded: number;
    deadStockCapital: number;
    marginErosionCount: number;
    riskyCashierCount: number;
  };
};

type VelocityRow = { productId: string; qtySold: number; revenue: number };

async function loadVelocity(days: number): Promise<Map<string, VelocityRow>> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      productId: salesOrderItems.productId,
      qtySold: sql<string>`coalesce(sum(${salesOrderItems.qty} - ${salesOrderItems.refundedQty}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineSubtotal}), 0)`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(and(sql`${salesOrders.status} <> 'VOIDED'`, gte(salesOrders.createdAt, since)))
    .groupBy(salesOrderItems.productId);

  const map = new Map<string, VelocityRow>();
  for (const row of rows) {
    if (!row.productId) continue;
    map.set(row.productId, {
      productId: row.productId,
      qtySold: Number(row.qtySold ?? 0),
      revenue: toNumber(row.revenue),
    });
  }
  return map;
}

/** Rule 1 — stock cover vs. lead time and reorder point. */
async function computeRestock(): Promise<DssRecommendation[]> {
  const db = await getDb();
  const settings = await getStoreSettings();
  const velocity = await loadVelocity(30);
  const rows = await db
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
    .where(eq(products.isActive, true));

  const recommendations: DssRecommendation[] = [];
  for (const row of rows) {
    const sold = velocity.get(row.id)?.qtySold ?? 0;
    const dailyVelocity = sold / 30;
    const daysLeft = computeDaysOfStock(row.stockOnHand, dailyVelocity);
    const belowReorder = row.stockOnHand <= row.reorderPoint;
    const belowLead = Number.isFinite(daysLeft) && daysLeft <= settings.leadTimeDays;
    if (!belowReorder && !belowLead) continue;

    const suggestedQty = Math.max(row.reorderQty, row.reorderPoint - row.stockOnHand + row.reorderQty, 1);
    const capital = rupiah(suggestedQty * toNumber(row.costPrice));
    const severity = row.stockOnHand <= 0 ? "critical" : belowReorder ? "warning" : "info";

    recommendations.push({
      ruleCode: "RESTOCK_URGENT",
      subjectId: row.id,
      subjectLabel: `${row.sku} · ${row.name}`,
      severity,
      headline: row.stockOnHand <= 0 ? "Stok habis" : `Sisa ${row.stockOnHand} unit`,
      detail: Number.isFinite(daysLeft)
        ? `Laju jual ${dailyVelocity.toFixed(2)} unit/hari, stok cukup untuk ${daysLeft} hari (lead time ${settings.leadTimeDays} hari).`
        : `Belum ada penjualan 30 hari terakhir, tetapi stok ${row.stockOnHand} unit sudah menyentuh titik pesan ulang ${row.reorderPoint}.`,
      metrics: [
        { label: "Stok", value: `${row.stockOnHand} unit` },
        { label: "Titik pesan ulang", value: `${row.reorderPoint} unit` },
        { label: "Saran pesan", value: `${suggestedQty} unit` },
        { label: "Estimasi modal", value: `Rp ${capital.toLocaleString("id-ID")}` },
      ],
      suggestedAction: `Pesan ${suggestedQty} unit ke supplier sekarang (estimasi modal Rp ${capital.toLocaleString("id-ID")}).`,
      payload: {
        stockOnHand: row.stockOnHand,
        reorderPoint: row.reorderPoint,
        suggestedQty,
        capital,
        dailyVelocity,
        daysLeft: Number.isFinite(daysLeft) ? daysLeft : null,
      },
    });
  }

  return recommendations.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });
}

/** Rule 2 — capital parked in slow movers. */
async function computeDeadStock(): Promise<DssRecommendation[]> {
  const db = await getDb();
  const velocity = await loadVelocity(30);
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      stockOnHand: products.stockOnHand,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
    })
    .from(products)
    .where(and(eq(products.isActive, true), sql`${products.stockOnHand} > 0`));

  const recommendations: DssRecommendation[] = [];
  for (const row of rows) {
    const sold = velocity.get(row.id)?.qtySold ?? 0;
    const lockedCapital = rupiah(row.stockOnHand * toNumber(row.costPrice));
    if (sold >= 2 || lockedCapital < 1_000_000) continue;

    recommendations.push({
      ruleCode: "DEAD_STOCK_CAPITAL",
      subjectId: row.id,
      subjectLabel: `${row.sku} · ${row.name}`,
      severity: lockedCapital >= 3_000_000 ? "critical" : "warning",
      headline: `Modal tertahan Rp ${lockedCapital.toLocaleString("id-ID")}`,
      detail: `Hanya ${sold} unit terjual dalam 30 hari, sementara ${row.stockOnHand} unit masih menumpuk di rak.`,
      metrics: [
        { label: "Stok", value: `${row.stockOnHand} unit` },
        { label: "Terjual 30 hari", value: `${sold} unit` },
        { label: "Modal tertahan", value: `Rp ${lockedCapital.toLocaleString("id-ID")}` },
        { label: "Harga eceran", value: `Rp ${toNumber(row.retailPrice).toLocaleString("id-ID")}` },
      ],
      suggestedAction: "Bundel dengan produk cepat laku atau jalankan diskon cuci gudang sebelum nilai modal makin tergerus.",
      payload: { stockOnHand: row.stockOnHand, sold, lockedCapital },
    });
  }

  return recommendations.sort((a, b) => (b.payload.lockedCapital as number) - (a.payload.lockedCapital as number));
}

/** Rule 3 — margin under the product's own floor after a cost increase. */
async function computeMarginErosion(): Promise<DssRecommendation[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      minMarginPct: products.minMarginPct,
      stockOnHand: products.stockOnHand,
    })
    .from(products)
    .where(eq(products.isActive, true));

  const recommendations: DssRecommendation[] = [];
  for (const row of rows) {
    const retail = toNumber(row.retailPrice);
    const cost = toNumber(row.costPrice);
    const floorPct = toNumber(row.minMarginPct);
    if (retail <= 0 || floorPct <= 0) continue;
    const marginPct = computeMarginPct(retail, cost);
    if (marginPct >= floorPct) continue;

    // Price that restores the floor: cost / (1 - floor/100), rounded up to 100.
    const targetRaw = cost / (1 - floorPct / 100);
    const suggestedPrice = Math.ceil(targetRaw / 100) * 100;
    const delta = rupiah(suggestedPrice - retail);

    recommendations.push({
      ruleCode: "MARGIN_EROSION",
      subjectId: row.id,
      subjectLabel: `${row.sku} · ${row.name}`,
      severity: marginPct < floorPct / 2 ? "critical" : "warning",
      headline: `Margin ${marginPct.toFixed(1)}% di bawah batas ${floorPct.toFixed(1)}%`,
      detail: `HPP saat ini Rp ${cost.toLocaleString("id-ID")} terhadap harga jual Rp ${retail.toLocaleString("id-ID")}. Setiap penjualan menekan laba di bawah target.`,
      metrics: [
        { label: "Margin berjalan", value: `${marginPct.toFixed(1)}%` },
        { label: "Margin minimum", value: `${floorPct.toFixed(1)}%` },
        { label: "Harga jual disarankan", value: `Rp ${suggestedPrice.toLocaleString("id-ID")}` },
        { label: "Selisih harga", value: `+Rp ${delta.toLocaleString("id-ID")}` },
      ],
      suggestedAction: `Naikkan harga jual menjadi Rp ${suggestedPrice.toLocaleString("id-ID")} atau negosiasi ulang harga beli.`,
      payload: { marginPct, floorPct, suggestedPrice, delta, cost, retail },
    });
  }

  return recommendations.sort((a, b) => (a.payload.marginPct as number) - (b.payload.marginPct as number));
}

/** Rule 4 — cash shortage and void/refund ratio per cashier over 14 days. */
async function computeCashierRisk(): Promise<DssRecommendation[]> {
  const db = await getDb();
  const since = new Date(Date.now() - 14 * 86_400_000);

  const shiftRows = await db
    .select({
      cashierId: posShifts.cashierId,
      cashierName: profiles.fullName,
      shiftCount: sql<string>`count(*)`,
      shortageTotal: sql<string>`coalesce(sum(case when ${posShifts.cashVariance} < 0 then ${posShifts.cashVariance} else 0 end), 0)`,
      worstVariance: sql<string>`coalesce(min(${posShifts.cashVariance}), 0)`,
      varianceShifts: sql<string>`count(*) filter (where ${posShifts.cashVariance} <> 0)`,
    })
    .from(posShifts)
    .leftJoin(profiles, eq(profiles.id, posShifts.cashierId))
    .where(and(gte(posShifts.openedAt, since), sql`${posShifts.status} <> 'OPEN'`))
    .groupBy(posShifts.cashierId, profiles.fullName);

  const salesRows = await db
    .select({
      cashierId: salesOrders.cashierId,
      salesTotal: sql<string>`coalesce(sum(case when ${salesOrders.status} <> 'VOIDED' then ${salesOrders.grandTotal} else 0 end), 0)`,
      voidTotal: sql<string>`coalesce(sum(case when ${salesOrders.status} = 'VOIDED' then ${salesOrders.grandTotal} else 0 end), 0)`,
      voidCount: sql<string>`count(*) filter (where ${salesOrders.status} = 'VOIDED')`,
      orderCount: sql<string>`count(*)`,
    })
    .from(salesOrders)
    .where(gte(salesOrders.createdAt, since))
    .groupBy(salesOrders.cashierId);

  const salesByCashier = new Map(salesRows.map((row) => [row.cashierId, row]));
  const recommendations: DssRecommendation[] = [];

  for (const shift of shiftRows) {
    const shortage = toNumber(shift.shortageTotal);
    const sales = salesByCashier.get(shift.cashierId);
    const salesTotal = toNumber(sales?.salesTotal);
    const voidTotal = toNumber(sales?.voidTotal);
    const voidRatio = salesTotal + voidTotal > 0 ? (voidTotal / (salesTotal + voidTotal)) * 100 : 0;

    const shortageFlag = shortage <= -50_000;
    const voidFlag = voidRatio >= 5 && toNumber(sales?.voidCount ?? 0) >= 1;
    if (!shortageFlag && !voidFlag) continue;

    const reasons: string[] = [];
    if (shortageFlag) reasons.push(`akumulasi selisih kas minus Rp ${Math.abs(shortage).toLocaleString("id-ID")}`);
    if (voidFlag) reasons.push(`rasio void ${voidRatio.toFixed(1)}% dari nilai penjualan`);

    recommendations.push({
      ruleCode: "CASHIER_RISK_ANOMALY",
      subjectId: shift.cashierId,
      subjectLabel: shift.cashierName ?? "Kasir tanpa nama",
      severity: shortage <= -150_000 || voidRatio >= 10 ? "critical" : "warning",
      headline: shortageFlag ? "Selisih kas berulang" : "Rasio void di atas wajar",
      detail: `Dalam 14 hari terakhir: ${reasons.join(" dan ")}.`,
      metrics: [
        { label: "Shift selesai", value: `${toNumber(shift.shiftCount)}` },
        { label: "Shift berselisih", value: `${toNumber(shift.varianceShifts)}` },
        { label: "Akumulasi kurang", value: `Rp ${Math.abs(shortage).toLocaleString("id-ID")}` },
        { label: "Rasio void", value: `${voidRatio.toFixed(1)}%` },
      ],
      suggestedAction: "Jadwalkan audit laci mendadak dan tinjau rekaman transaksi void kasir ini.",
      payload: { shortage, voidRatio, voidTotal, salesTotal, worstVariance: toNumber(shift.worstVariance) },
    });
  }

  return recommendations.sort((a, b) => Math.abs(b.payload.shortage as number) - Math.abs(a.payload.shortage as number));
}

/** Full on-the-fly report for /dss and /dss/restock etc. */
export async function buildDssReport(): Promise<DssReport> {
  const [restock, deadStock, marginErosion, cashierRisk] = await Promise.all([
    computeRestock(),
    computeDeadStock(),
    computeMarginErosion(),
    computeCashierRisk(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    restock,
    deadStock,
    marginErosion,
    cashierRisk,
    totals: {
      urgentRestockCount: restock.length,
      restockCapitalNeeded: restock.reduce((sum, item) => sum + Number(item.payload.capital ?? 0), 0),
      deadStockCapital: deadStock.reduce((sum, item) => sum + Number(item.payload.lockedCapital ?? 0), 0),
      marginErosionCount: marginErosion.length,
      riskyCashierCount: cashierRisk.length,
    },
  };
}

export async function listDecisionRules() {
  const db = await getDb();
  return db.select().from(decisionRules).orderBy(decisionRules.code);
}

/** Persists a recommendation so its handling is auditable. */
export async function logDecision(input: {
  ruleCode: DecisionCategory;
  subjectId: string;
  subjectLabel: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(decisionLogs)
    .values({
      ruleCode: input.ruleCode,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      payload: input.payload,
      status: "NEW",
    })
    .returning({ id: decisionLogs.id });
  return row.id;
}

export async function updateDecisionStatus(input: {
  decisionId: string;
  status: "ACKNOWLEDGED" | "ACTIONED" | "DISMISSED";
  actorId: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(decisionLogs)
    .set({ status: input.status, actedBy: input.actorId, actedAt: new Date() })
    .where(eq(decisionLogs.id, input.decisionId));
}

export async function listCashierShiftDetail(cashierId: string) {
  const db = await getDb();
  return db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      closedAt: posShifts.closedAt,
      cashVariance: posShifts.cashVariance,
    })
    .from(posShifts)
    .where(eq(posShifts.cashierId, cashierId))
    .orderBy(desc(posShifts.openedAt))
    .limit(10);
}

export async function listDecisionHistory(limit = 60) {
  const db = await getDb();
  return db
    .select({
      id: decisionLogs.id,
      ruleCode: decisionLogs.ruleCode,
      subjectLabel: decisionLogs.subjectLabel,
      status: decisionLogs.status,
      payload: decisionLogs.payload,
      createdAt: decisionLogs.createdAt,
      actedAt: decisionLogs.actedAt,
      actedByName: profiles.fullName,
    })
    .from(decisionLogs)
    .leftJoin(profiles, eq(profiles.id, decisionLogs.actedBy))
    .orderBy(desc(decisionLogs.createdAt))
    .limit(limit);
}
