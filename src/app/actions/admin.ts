"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/rbac";
import { fail, type ActionResult } from "@/server/services/errors";
import { createStockOpname, approveStockOpname, rejectStockOpname, createPurchaseReceipt, writeOffDamaged } from "@/server/services/inventoryEngine";
import { upsertProduct } from "@/server/services/products";
import { toNumber, toInt } from "@/lib/format";
import { createCustomer, updateCustomer } from "@/server/services/customers";
import { createPromo, togglePromo } from "@/server/services/promos";
import { updateStoreSettings, type StoreSettings } from "@/server/services/settings";
import { hashPin, verifyPin } from "@/server/crypto";
import { getDb } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "@/server/rbac";

const PRODUCT_ROLES = ["SUPER_ADMIN", "STORE_MANAGER"] as const;
const INVENTORY_ROLES = ["SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF"] as const;

export async function saveProductAction(input: {
  id?: string;
  sku: string;
  barcode?: string;
  name: string;
  categoryId?: string;
  unit: string;
  costPrice: number;
  retailPrice: number;
  minMarginPct: number;
  reorderPoint: number;
  reorderQty: number;
  isTaxable: boolean;
  isActive: boolean;
  tiers: { minQty: number; tierUnitPrice: number; label: string }[];
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(...PRODUCT_ROLES);
    if (!input.sku.trim()) return { ok: false, error: "SKU wajib diisi." };
    if (!input.name.trim()) return { ok: false, error: "Nama produk wajib diisi." };
    if (toNumber(input.retailPrice) <= 0) return { ok: false, error: "Harga jual harus lebih dari nol." };

    const product = await upsertProduct({
      id: input.id,
      sku: input.sku,
      barcode: input.barcode,
      name: input.name,
      categoryId: input.categoryId || null,
      unit: input.unit,
      costPrice: toNumber(input.costPrice),
      retailPrice: toNumber(input.retailPrice),
      minMarginPct: toNumber(input.minMarginPct),
      reorderPoint: toInt(input.reorderPoint),
      reorderQty: toInt(input.reorderQty),
      isTaxable: input.isTaxable,
      isActive: input.isActive,
      actorId: user.id,
      tiers: input.tiers,
    });

    await writeAudit({
      actorId: user.id,
      action: input.id ? "PRODUCT_UPDATED" : "PRODUCT_CREATED",
      entityType: "product",
      entityId: product.id,
      metadata: { sku: product.sku, retailPrice: product.retailPrice, costPrice: product.costPrice },
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/pos");
    return { ok: true, data: { id: product.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function receiveStockAction(input: {
  supplierId?: string;
  notes?: string;
  items: { productId: string; qty: number; unitCost: number }[];
}): Promise<ActionResult<{ receiptNumber: string; totalAmount: number }>> {
  try {
    const user = await requireRole(...INVENTORY_ROLES);
    const result = await createPurchaseReceipt({
      supplierId: input.supplierId || null,
      receivedBy: user.id,
      notes: input.notes,
      items: input.items,
    });
    revalidatePath("/inventory");
    revalidatePath("/inventory/receiving");
    revalidatePath("/products");
    revalidatePath("/admin");
    return { ok: true, data: { receiptNumber: result.receiptNumber, totalAmount: result.totalAmount } };
  } catch (error) {
    return fail(error);
  }
}

export async function createOpnameAction(input: {
  notes?: string;
  items: { productId: string; physicalQtyCounted: number }[];
}): Promise<ActionResult<{ opnameNumber: string; varianceValue: number }>> {
  try {
    const user = await requireRole(...INVENTORY_ROLES);
    const result = await createStockOpname({
      createdBy: user.id,
      notes: input.notes,
      items: input.items,
    });
    revalidatePath("/inventory/opname");
    revalidatePath("/inventory");
    return { ok: true, data: { opnameNumber: result.opnameNumber, varianceValue: result.varianceValue } };
  } catch (error) {
    return fail(error);
  }
}

export async function approveOpnameAction(input: { opnameId: string }): Promise<ActionResult<{ adjusted: number }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const result = await approveStockOpname({ opnameId: input.opnameId, managerId: user.id });
    revalidatePath("/inventory/opname");
    revalidatePath("/inventory");
    revalidatePath("/dss");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function rejectOpnameAction(input: { opnameId: string; reason: string }): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    await rejectStockOpname({ opnameId: input.opnameId, managerId: user.id, reason: input.reason });
    revalidatePath("/inventory/opname");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function writeOffAction(input: { productId: string; qty: number; reason: string }): Promise<ActionResult> {
  try {
    const user = await requireRole(...INVENTORY_ROLES);
    await writeOffDamaged({ productId: input.productId, qty: toInt(input.qty), actorId: user.id, reason: input.reason });
    revalidatePath("/inventory");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveCustomerAction(input: {
  id?: string;
  name: string;
  phone?: string;
  tier: "REGULAR" | "SILVER" | "GOLD" | "VIP";
  discountPct: number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
    if (!input.name.trim()) return { ok: false, error: "Nama pelanggan wajib diisi." };
    const row = input.id
      ? await updateCustomer({ id: input.id, name: input.name, phone: input.phone, tier: input.tier, discountPct: toNumber(input.discountPct) })
      : await createCustomer({ name: input.name, phone: input.phone, tier: input.tier, discountPct: toNumber(input.discountPct) });
    await writeAudit({
      actorId: user.id,
      action: input.id ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED",
      entityType: "customer",
      entityId: row.id,
      metadata: { memberCode: row.memberCode, tier: row.tier },
    });
    revalidatePath("/customers");
    revalidatePath("/pos");
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function savePromoAction(input: {
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minSubtotal: number;
  maxDiscountCap: number;
  validFrom: string;
  validUntil: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const promo = await createPromo({
      code: input.code,
      name: input.name,
      discountType: input.discountType,
      discountValue: toNumber(input.discountValue),
      minSubtotal: toNumber(input.minSubtotal),
      maxDiscountCap: toNumber(input.maxDiscountCap),
      validFrom: new Date(input.validFrom),
      validUntil: new Date(input.validUntil),
    });
    await writeAudit({
      actorId: user.id,
      action: "PROMO_CREATED",
      entityType: "promo",
      entityId: promo.id,
      metadata: { code: promo.code, type: promo.discountType, value: promo.discountValue },
    });
    revalidatePath("/promos");
    revalidatePath("/pos");
    return { ok: true, data: { id: promo.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function togglePromoAction(input: { promoId: string; isActive: boolean }): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    await togglePromo(input.promoId, input.isActive);
    await writeAudit({
      actorId: user.id,
      action: input.isActive ? "PROMO_ENABLED" : "PROMO_DISABLED",
      entityType: "promo",
      entityId: input.promoId,
    });
    revalidatePath("/promos");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveSettingsAction(patch: Partial<StoreSettings>): Promise<ActionResult<StoreSettings>> {
  try {
    const user = await requireRole("SUPER_ADMIN");
    const updated = await updateStoreSettings(patch, user.id);
    await writeAudit({
      actorId: user.id,
      action: "SETTINGS_UPDATED",
      entityType: "app_settings",
      entityId: "store",
      metadata: patch as Record<string, unknown>,
    });
    revalidatePath("/admin/settings");
    revalidatePath("/pos");
    revalidatePath("/login");
    return { ok: true, data: updated };
  } catch (error) {
    return fail(error);
  }
}

export async function setSupervisorPinAction(input: {
  userId: string;
  pin: string;
  currentPin?: string;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN");
    if (!/^\d{6}$/.test(input.pin)) return { ok: false, error: "PIN harus 6 digit angka." };

    const db = await getDb();
    const [target] = await db.select().from(profiles).where(eq(profiles.id, input.userId)).limit(1);
    if (!target) return { ok: false, error: "Pengguna tidak ditemukan." };
    if (!["SUPER_ADMIN", "STORE_MANAGER"].includes(target.role)) {
      return { ok: false, error: "PIN Supervisor hanya untuk SUPER_ADMIN atau STORE_MANAGER." };
    }
    if (target.supervisorPinHash && input.currentPin && !verifyPin(input.currentPin, target.supervisorPinHash)) {
      return { ok: false, error: "PIN lama tidak cocok." };
    }

    await db.update(profiles).set({ supervisorPinHash: hashPin(input.pin) }).where(eq(profiles.id, input.userId));
    await writeAudit({
      actorId: user.id,
      action: "SUPERVISOR_PIN_UPDATED",
      entityType: "profile",
      entityId: input.userId,
      severity: "WARNING",
      metadata: { targetEmail: target.email },
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
