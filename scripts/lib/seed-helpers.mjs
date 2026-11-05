/**
 * Shared seeding/maths helpers for scripts running against the raw driver.
 * Mirrors src/lib/posMath.ts formulas so seeded receipts match what the app
 * would compute for the same basket (the e2e script verifies the TS module).
 */
import { randomBytes, scryptSync, createHmac } from "node:crypto";

export const DEMO_PASSWORD = "katalis123";
export const OWNER_PIN = "123456";
export const MANAGER_PIN = "654321";
export const DEMO_SIGNING_KEY = "katalis-pos-demo-receipt-signing-key-do-not-use-in-production";

export function hashSecret(plain) {
  const salt = randomBytes(16);
  const derived = scryptSync(plain.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Deterministic hash for idempotent seeds: same salt for the same label. */
export function hashSecretStable(plain, label) {
  const salt = createHmac("sha256", "katalis-seed-salt").update(label).digest().subarray(0, 16);
  const derived = scryptSync(plain.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function calcLine(basePrice, qty, tiers = []) {
  let applied = basePrice;
  let tierLabel = null;
  for (const tier of tiers) {
    if (qty >= tier.minQty && tier.tierUnitPrice < applied) {
      applied = tier.tierUnitPrice;
      tierLabel = tier.label;
    }
  }
  return { applied, tierLabel, lineSubtotal: applied * qty, tierSaving: (basePrice - applied) * qty };
}

export function roundRupiah(value) {
  return Math.round(value);
}

/** Layered totals: subtotal → member% → promo(capped) → manual → PPN → rounding. */
export function calcTotals({ lines, memberDiscountPct = 0, promo = null, manualDiscount = 0, taxRatePct = 11, priceIncludesTax = false, cashRoundingStep = 100, paymentMethod = "CASH" }) {
  const resolved = lines.map((line) => {
    const calc = calcLine(line.baseUnitPrice, line.qty, line.tiers ?? []);
    return { ...line, ...calc, unitCogs: line.costPrice, lineCogs: line.costPrice * line.qty };
  });
  const subtotal = resolved.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const tierDiscountTotal = resolved.reduce((sum, line) => sum + line.tierSaving, 0);
  const totalCogs = resolved.reduce((sum, line) => sum + line.lineCogs, 0);

  const memberDiscountAmount = Math.min(subtotal, roundRupiah((subtotal * memberDiscountPct) / 100));
  const afterMember = subtotal - memberDiscountAmount;

  let promoDiscountAmount = 0;
  if (promo && afterMember >= promo.minSubtotal) {
    const raw = promo.discountType === "PERCENTAGE" ? (afterMember * promo.discountValue) / 100 : promo.discountValue;
    promoDiscountAmount = roundRupiah(promo.maxDiscountCap > 0 ? Math.min(raw, promo.maxDiscountCap) : raw);
  }
  const afterPromo = afterMember - promoDiscountAmount;
  const manualDiscountAmount = Math.min(afterPromo, roundRupiah(manualDiscount));
  const totalDiscount = memberDiscountAmount + promoDiscountAmount + manualDiscountAmount;

  const netBeforeTax = subtotal - totalDiscount;
  const ratio = subtotal > 0 ? netBeforeTax / subtotal : 0;
  let taxableBase = 0;
  for (const line of resolved) if (line.isTaxable) taxableBase += line.lineSubtotal * ratio;
  taxableBase = roundRupiah(taxableBase);

  let taxAmount;
  let gross;
  if (priceIncludesTax) {
    taxAmount = roundRupiah((taxableBase * taxRatePct) / (100 + taxRatePct));
    gross = netBeforeTax;
  } else {
    taxAmount = roundRupiah((taxableBase * taxRatePct) / 100);
    gross = netBeforeTax + taxAmount;
  }

  let roundingAdjustment = 0;
  if (paymentMethod === "CASH" && cashRoundingStep > 1) {
    const rounded = Math.round(gross / cashRoundingStep) * cashRoundingStep;
    roundingAdjustment = rounded - gross;
  }
  const grandTotal = Math.max(0, gross + roundingAdjustment);

  return {
    lines: resolved,
    subtotal,
    tierDiscountTotal,
    memberDiscountAmount,
    promoDiscountAmount,
    manualDiscountAmount,
    totalDiscount,
    taxableBase,
    taxAmount,
    roundingAdjustment,
    grandTotal,
    totalCogs,
  };
}

export function signReceipt({ orderId, receiptNumber, createdAt, grandTotal }) {
  const message = [orderId, receiptNumber, createdAt, String(Math.round(Number(grandTotal)))].join("|");
  return createHmac("sha256", process.env.RECEIPT_SIGNING_KEY?.trim() || DEMO_SIGNING_KEY)
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function daysAgo(days, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function iso(date) {
  return date.toISOString();
}
