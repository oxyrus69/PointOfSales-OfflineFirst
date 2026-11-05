/**
 * posMath.ts — pure, dependency-free pricing engine.
 *
 * Runs identically inside the offline cashier browser (IndexedDB snapshot) and
 * inside the server validator, so a receipt can never drift between the two.
 * All money is whole Indonesian rupiah (no cents), all percentages are numbers.
 */

export type PriceTierInput = {
  minQty: number;
  tierUnitPrice: number;
  label: string;
};

export type CartLineInput = {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  baseUnitPrice: number;
  costPrice: number;
  isTaxable: boolean;
  tiers?: PriceTierInput[];
};

export type PromoInput = {
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minSubtotal: number;
  maxDiscountCap: number;
};

export type TaxSettings = {
  /** PPN percentage, e.g. 11 */
  taxRatePct: number;
  /** true = harga jual sudah termasuk pajak (inclusive) */
  priceIncludesTax: boolean;
  /** pembulatan tunai, e.g. 100 */
  cashRoundingStep: number;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  taxRatePct: 11,
  priceIncludesTax: false,
  cashRoundingStep: 100,
};

export type PaymentKind = "CASH" | "QRIS" | "DEBIT_CARD" | "CREDIT_CARD" | "SPLIT_PAYMENT";

export type ResolvedLine = {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  baseUnitPrice: number;
  appliedUnitPrice: number;
  tierLabel: string | null;
  tierSaving: number;
  lineSubtotal: number;
  unitCogs: number;
  lineCogs: number;
  isTaxable: boolean;
};

export type CartTotals = {
  lines: ResolvedLine[];
  itemCount: number;
  subtotal: number;
  tierDiscountTotal: number;
  memberDiscountAmount: number;
  promoDiscountAmount: number;
  manualDiscountAmount: number;
  totalDiscount: number;
  taxableBase: number;
  nonTaxableBase: number;
  taxAmount: number;
  roundingAdjustment: number;
  grandTotal: number;
  totalCogs: number;
  grossMargin: number;
  grossMarginPct: number;
};

export type CartTotalsInput = {
  lines: CartLineInput[];
  memberDiscountPct?: number;
  promo?: PromoInput | null;
  manualDiscountAmount?: number;
  paymentMethod?: PaymentKind;
  tax?: Partial<TaxSettings>;
};

/** Round to whole rupiah (IDR has no circulating subunit). */
export function rupiah(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Pick the tier unit price with the lowest price among tiers whose minQty is
 * satisfied by the ordered quantity. Base price wins when nothing qualifies.
 */
export function resolveTierPricePure(
  baseRetailPrice: number,
  qty: number,
  tiers: PriceTierInput[] = [],
): { appliedUnitPrice: number; tierLabel: string | null; tierSaving: number } {
  const base = clampNonNegative(baseRetailPrice);
  const quantity = Math.max(0, Math.trunc(qty));
  let best: PriceTierInput | null = null;

  for (const tier of tiers) {
    if (!Number.isFinite(tier.tierUnitPrice) || tier.tierUnitPrice <= 0) continue;
    if (quantity < Math.max(1, Math.trunc(tier.minQty))) continue;
    if (tier.tierUnitPrice >= base) continue;
    if (!best || tier.tierUnitPrice < best.tierUnitPrice) best = tier;
  }

  const appliedUnitPrice = best ? rupiah(best.tierUnitPrice) : rupiah(base);
  const tierSaving = rupiah((base - appliedUnitPrice) * quantity);
  return {
    appliedUnitPrice,
    tierLabel: best ? best.label : null,
    tierSaving: Math.max(0, tierSaving),
  };
}

function resolveLines(lines: CartLineInput[]): ResolvedLine[] {
  return lines
    .filter((line) => line.qty > 0)
    .map((line) => {
      const qty = Math.max(1, Math.trunc(line.qty));
      const baseUnitPrice = rupiah(clampNonNegative(line.baseUnitPrice));
      const { appliedUnitPrice, tierLabel, tierSaving } = resolveTierPricePure(
        baseUnitPrice,
        qty,
        line.tiers ?? [],
      );
      const unitCogs = rupiah(clampNonNegative(line.costPrice));
      return {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        qty,
        baseUnitPrice,
        appliedUnitPrice,
        tierLabel,
        tierSaving,
        lineSubtotal: rupiah(appliedUnitPrice * qty),
        unitCogs,
        lineCogs: rupiah(unitCogs * qty),
        isTaxable: line.isTaxable,
      };
    });
}

/**
 * Resolve promo discount: apply the promo's own rules (min subtotal, percentage
 * or fixed amount, and the hard rupiah cap) against the subtotal *after* the
 * member discount has been taken off.
 */
export function computePromoDiscountPure(
  promo: PromoInput | null | undefined,
  subtotalAfterMember: number,
): number {
  if (!promo) return 0;
  const base = clampNonNegative(subtotalAfterMember);
  if (base <= 0) return 0;
  if (base < clampNonNegative(promo.minSubtotal)) return 0;

  const raw = promo.discountType === "PERCENTAGE"
    ? (base * clampNonNegative(promo.discountValue)) / 100
    : clampNonNegative(promo.discountValue);

  const cap = clampNonNegative(promo.maxDiscountCap);
  const capped = cap > 0 ? Math.min(raw, cap) : raw;
  return Math.min(rupiah(capped), rupiah(base));
}

/**
 * Full layered cart calculation:
 * subtotal → member % → promo (capped) → manual → proportional taxable base →
 * PPN (inclusive or exclusive) → cash rounding to the nearest step.
 */
export function calculateCartTotalsPure(input: CartTotalsInput): CartTotals {
  const tax: TaxSettings = { ...DEFAULT_TAX_SETTINGS, ...(input.tax ?? {}) };
  const lines = resolveLines(input.lines);

  const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const tierDiscountTotal = lines.reduce((sum, line) => sum + line.tierSaving, 0);
  const totalCogs = lines.reduce((sum, line) => sum + line.lineCogs, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);

  if (subtotal <= 0) {
    return {
      lines,
      itemCount,
      subtotal: 0,
      tierDiscountTotal,
      memberDiscountAmount: 0,
      promoDiscountAmount: 0,
      manualDiscountAmount: 0,
      totalDiscount: 0,
      taxableBase: 0,
      nonTaxableBase: 0,
      taxAmount: 0,
      roundingAdjustment: 0,
      grandTotal: 0,
      totalCogs,
      grossMargin: 0,
      grossMarginPct: 0,
    };
  }

  const memberDiscountAmount = Math.min(
    subtotal,
    rupiah((subtotal * clampNonNegative(input.memberDiscountPct ?? 0)) / 100),
  );

  const afterMember = subtotal - memberDiscountAmount;
  const promoDiscountAmount = computePromoDiscountPure(input.promo, afterMember);
  const afterPromo = afterMember - promoDiscountAmount;

  const requestedManual = rupiah(clampNonNegative(input.manualDiscountAmount ?? 0));
  const manualDiscountAmount = Math.min(afterPromo, requestedManual);
  const totalDiscount = memberDiscountAmount + promoDiscountAmount + manualDiscountAmount;

  const netBeforeTax = subtotal - totalDiscount;
  const discountRatio = subtotal > 0 ? netBeforeTax / subtotal : 0;

  let taxableBase = 0;
  let nonTaxableBase = 0;
  for (const line of lines) {
    const lineNet = line.lineSubtotal * discountRatio;
    if (line.isTaxable) taxableBase += lineNet;
    else nonTaxableBase += lineNet;
  }
  taxableBase = rupiah(taxableBase);
  nonTaxableBase = rupiah(nonTaxableBase);

  const rate = Math.max(0, tax.taxRatePct);
  let taxAmount: number;
  let grandBeforeRounding: number;

  if (tax.priceIncludesTax) {
    // Gross-inclusive: the tax is carved out of the taxable portion only.
    taxAmount = rate > 0 ? rupiah((taxableBase * rate) / (100 + rate)) : 0;
    grandBeforeRounding = netBeforeTax;
  } else {
    taxAmount = rate > 0 ? rupiah((taxableBase * rate) / 100) : 0;
    grandBeforeRounding = netBeforeTax + taxAmount;
  }

  const rounding = computeCashRoundingPure(grandBeforeRounding, input.paymentMethod ?? "CASH", tax.cashRoundingStep);
  const grandTotal = Math.max(0, grandBeforeRounding + rounding);
  const grossMargin = grandTotal - taxAmount - totalCogs;
  const grossMarginPct = grandTotal - taxAmount > 0
    ? Math.round((grossMargin / (grandTotal - taxAmount)) * 10000) / 100
    : 0;

  return {
    lines,
    itemCount,
    subtotal,
    tierDiscountTotal,
    memberDiscountAmount,
    promoDiscountAmount,
    manualDiscountAmount,
    totalDiscount,
    taxableBase,
    nonTaxableBase,
    taxAmount,
    roundingAdjustment: rounding,
    grandTotal,
    totalCogs,
    grossMargin,
    grossMarginPct,
  };
}

/**
 * Cash rounding to the nearest step (default Rp 100). Non-cash payments are
 * never rounded because QRIS/card settle the exact invoice amount.
 */
export function computeCashRoundingPure(
  amount: number,
  paymentMethod: PaymentKind,
  step = 100,
): number {
  if (paymentMethod !== "CASH") return 0;
  const safeStep = Math.trunc(step);
  if (!Number.isFinite(safeStep) || safeStep <= 1) return 0;
  const target = rupiah(amount);
  const rounded = Math.round(target / safeStep) * safeStep;
  return rounded - target;
}

/** Weighted-average COGS after a purchase receipt (negative stock floored at 0). */
export function computeWeightedAverageCogsPure(
  oldQty: number,
  oldCost: number,
  newQty: number,
  newCost: number,
): number {
  const qOld = Math.max(0, Math.trunc(Number.isFinite(oldQty) ? oldQty : 0));
  const qNew = Math.max(0, Math.trunc(Number.isFinite(newQty) ? newQty : 0));
  const cOld = clampNonNegative(oldCost);
  const cNew = clampNonNegative(newCost);
  const totalQty = qOld + qNew;
  if (totalQty <= 0) return rupiah(cNew);
  return rupiah((qOld * cOld + qNew * cNew) / totalQty);
}

/** Expected cash in the drawer at blind close, per the system's own books. */
export function computeExpectedCashPure(input: {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashInMisc: number;
  cashOutExpense: number;
  cashDropSafe: number;
}): number {
  return rupiah(
    clampNonNegative(input.openingCash) +
      clampNonNegative(input.cashSales) -
      clampNonNegative(input.cashRefunds) +
      clampNonNegative(input.cashInMisc) -
      clampNonNegative(input.cashOutExpense) -
      clampNonNegative(input.cashDropSafe),
  );
}

/** Split-payment change: only the cash portion can produce change. */
export function computeChangePure(grandTotal: number, cashReceived: number): number {
  return Math.max(0, rupiah(clampNonNegative(cashReceived) - clampNonNegative(grandTotal)));
}

/** Quick-cash suggestion chips for the checkout pad. */
export function suggestQuickCash(grandTotal: number): number[] {
  const total = Math.max(0, rupiah(grandTotal));
  if (total <= 0) return [0];
  const denominations = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const suggestions = new Set<number>([total]);
  const nextTenThousand = Math.ceil(total / 10000) * 10000;
  const nextFiftyThousand = Math.ceil(total / 50000) * 50000;
  if (nextTenThousand > total) suggestions.add(nextTenThousand);
  if (nextFiftyThousand > total) suggestions.add(nextFiftyThousand);
  for (const denom of denominations) {
    const rounded = Math.ceil(total / denom) * denom;
    if (rounded > total) suggestions.add(rounded);
  }
  return Array.from(suggestions).sort((a, b) => a - b).slice(0, 6);
}

/** Margin check used by DSS margin erosion and by the manual discount guard. */
export function computeMarginPct(retailPrice: number, costPrice: number): number {
  const retail = clampNonNegative(retailPrice);
  if (retail <= 0) return 0;
  const cost = clampNonNegative(costPrice);
  return Math.round(((retail - cost) / retail) * 10000) / 100;
}

/** Days of stock left; Infinity when nothing sells. */
export function computeDaysOfStock(stockOnHand: number, dailyVelocity: number): number {
  const stock = Math.trunc(stockOnHand);
  const velocity = clampNonNegative(dailyVelocity);
  if (velocity <= 0) return Number.POSITIVE_INFINITY;
  return Math.round((stock / velocity) * 10) / 10;
}
