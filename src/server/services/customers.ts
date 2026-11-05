import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { customers, salesOrders } from "@/server/db/schema";
import { moneyString, toInt, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/server/services/sequences";

export type CustomerRow = {
  id: string;
  memberCode: string;
  name: string;
  phone: string | null;
  tier: "REGULAR" | "SILVER" | "GOLD" | "VIP";
  discountPct: number;
  pointsBalance: number;
  totalSpent: number;
  createdAt: Date;
};

export async function listCustomers(options?: { search?: string; limit?: number }): Promise<CustomerRow[]> {
  const db = await getDb();
  const conditions: SQL[] = [];
  const search = options?.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const clause = or(
      ilike(customers.name, pattern),
      ilike(customers.memberCode, pattern),
      ilike(customers.phone, pattern),
    );
    if (clause) conditions.push(clause);
  }
  const rows = await db
    .select()
    .from(customers)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(customers.name))
    .limit(options?.limit ?? 200);
  return rows.map((row) => ({
    id: row.id,
    memberCode: row.memberCode,
    name: row.name,
    phone: row.phone,
    tier: row.tier,
    discountPct: toNumber(row.discountPct),
    pointsBalance: row.pointsBalance,
    totalSpent: toNumber(row.totalSpent),
    createdAt: row.createdAt,
  }));
}

export async function getCustomerById(id: string): Promise<CustomerRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    memberCode: row.memberCode,
    name: row.name,
    phone: row.phone,
    tier: row.tier,
    discountPct: toNumber(row.discountPct),
    pointsBalance: row.pointsBalance,
    totalSpent: toNumber(row.totalSpent),
    createdAt: row.createdAt,
  };
}

export async function findCustomerByCode(code: string): Promise<CustomerRow | null> {
  const value = code.trim();
  if (!value) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(or(eq(customers.memberCode, value.toUpperCase()), eq(customers.phone, value)))
    .limit(1);
  if (!row) return null;
  return getCustomerById(row.id);
}

const TIER_DISCOUNT: Record<CustomerRow["tier"], number> = {
  REGULAR: 0,
  SILVER: 2,
  GOLD: 5,
  VIP: 8,
};

export async function createCustomer(input: {
  name: string;
  phone?: string | null;
  tier?: CustomerRow["tier"];
  discountPct?: number;
}): Promise<CustomerRow> {
  const db = await getDb();
  const memberCode = await nextDocumentNumber("customer", "MBR", 5);
  const tier = input.tier ?? "REGULAR";
  const [row] = await db
    .insert(customers)
    .values({
      memberCode,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      tier,
      discountPct: moneyString(input.discountPct ?? TIER_DISCOUNT[tier]),
    })
    .returning();
  return {
    id: row.id,
    memberCode: row.memberCode,
    name: row.name,
    phone: row.phone,
    tier: row.tier,
    discountPct: toNumber(row.discountPct),
    pointsBalance: row.pointsBalance,
    totalSpent: toNumber(row.totalSpent),
    createdAt: row.createdAt,
  };
}

export async function updateCustomer(input: {
  id: string;
  name?: string;
  phone?: string | null;
  tier?: CustomerRow["tier"];
  discountPct?: number;
}): Promise<CustomerRow> {
  const db = await getDb();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.tier !== undefined) patch.tier = input.tier;
  if (input.discountPct !== undefined) patch.discountPct = moneyString(input.discountPct);
  const [row] = await db.update(customers).set(patch).where(eq(customers.id, input.id)).returning();
  return {
    id: row.id,
    memberCode: row.memberCode,
    name: row.name,
    phone: row.phone,
    tier: row.tier,
    discountPct: toNumber(row.discountPct),
    pointsBalance: row.pointsBalance,
    totalSpent: toNumber(row.totalSpent),
    createdAt: row.createdAt,
  };
}

/** Applies spend + loyalty points after a completed (non-voided) sale. */
export async function accrueCustomerSpend(customerId: string, grandTotal: number): Promise<void> {
  const db = await getDb();
  const points = Math.floor(grandTotal / 10_000);
  await db
    .update(customers)
    .set({
      totalSpent: sql`${customers.totalSpent} + ${moneyString(grandTotal)}`,
      pointsBalance: sql`${customers.pointsBalance} + ${points}`,
    })
    .where(eq(customers.id, customerId));
}

export async function customerPurchaseHistory(customerId: string, limit = 20) {
  const db = await getDb();
  return db
    .select({
      id: salesOrders.id,
      receiptNumber: salesOrders.receiptNumber,
      createdAt: salesOrders.createdAt,
      grandTotal: salesOrders.grandTotal,
      status: salesOrders.status,
      paymentMethod: salesOrders.paymentMethod,
    })
    .from(salesOrders)
    .where(eq(salesOrders.customerId, customerId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(limit);
}

export async function topCustomers(limit = 8) {
  const db = await getDb();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      tier: customers.tier,
      totalSpent: customers.totalSpent,
      pointsBalance: customers.pointsBalance,
    })
    .from(customers)
    .orderBy(desc(customers.totalSpent))
    .limit(limit);
  return rows.map((row) => ({ ...row, totalSpent: toNumber(row.totalSpent) }));
}
