"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Check,
  CircleAlert,
  CreditCard,
  Loader2,
  Minus,
  Pause,
  Plus,
  Printer,
  QrCode,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  calculateCartTotalsPure,
  computeChangePure,
  resolveTierPricePure,
  suggestQuickCash,
  type CartLineInput,
  type PromoInput,
} from "@/lib/posMath";
import {
  findCachedProduct,
  newClientRequestId,
  offlineDb,
  searchCachedProducts,
  type CatalogSnapshot,
  type CachedProduct,
  type HeldBill,
  type OfflineLine,
  type OutboxSale,
} from "@/lib/offlineDb";
import { formatIdr, toNumber } from "@/lib/format";
import { checkoutAction } from "@/app/actions/pos";
import { Badge, Money } from "@/components/ui";

type CartLine = OfflineLine & { lineKey: string };
type Mode = "ONLINE" | "OFFLINE";
type PaymentMethod = "CASH" | "QRIS" | "DEBIT_CARD" | "SPLIT_PAYMENT";
type Panel = "NONE" | "PAY" | "HOLD" | "HELD" | "CUSTOMER" | "PROMO" | "SUPERVISOR" | "DRAWER";

const KEY_CAPACITY = 9;

/** Offline receipts have no server id yet; the queue page prints them later. */
function offlineReceiptHref(): string {
  return "/pos/sync";
}

export function PosTerminal({
  initialSnapshot,
  cashierId,
  cashierName,
  shiftId,
  shiftNumber,
  terminalId,
  storeName,
  taxRatePct,
  priceIncludesTax,
  cashRoundingStep,
  cashierDiscountLimitPct,
}: {
  initialSnapshot: CatalogSnapshot;
  cashierId: string;
  cashierName: string;
  shiftId: string | null;
  shiftNumber: string | null;
  terminalId: string;
  storeName: string;
  taxRatePct: number;
  priceIncludesTax: boolean;
  cashRoundingStep: number;
  cashierDiscountLimitPct: number;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(initialSnapshot);
  const [mode, setMode] = useState<Mode>("ONLINE");
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");

  const [customer, setCustomer] = useState<{ id: string; name: string; tier: string; discountPct: number; memberCode: string } | null>(null);
  const [promo, setPromo] = useState<PromoInput | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [manualDiscount, setManualDiscount] = useState(0);
  const [supervisorPin, setSupervisorPin] = useState("");

  const [panel, setPanel] = useState<Panel>("NONE");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [cashInput, setCashInput] = useState("");
  const [splitCashInput, setSplitCashInput] = useState("");
  const [reference, setReference] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string } | null>(null);

  /* ------------------------------------------------------------- utilities */

  const refreshLocal = useCallback(async () => {
    const [count, held] = await Promise.all([offlineDb.countOutbox(), offlineDb.listHeldBills()]);
    setQueueCount(count);
    setHeldBills(held);
  }, []);

  useEffect(() => {
    void refreshLocal();
    const handle = () => setIsOnline(navigator.onLine);
    handle();
    window.addEventListener("online", handle);
    window.addEventListener("offline", handle);
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("offline", handle);
    };
  }, [refreshLocal]);

  const offlineActive = mode === "OFFLINE" || !isOnline;

  const pullSnapshot = useCallback(async () => {
    if (mode === "OFFLINE" || !navigator.onLine) return;
    try {
      const response = await fetch("/api/pos/catalog-snapshot", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { ok: boolean; snapshot?: CatalogSnapshot };
      if (payload.ok && payload.snapshot) {
        await offlineDb.saveCatalog(payload.snapshot);
        setSnapshot(payload.snapshot);
      }
    } catch {
      // silent: offline behaviour takes over
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "ONLINE" && isOnline) void pullSnapshot();
  }, [mode, isOnline, pullSnapshot]);

  /* ---------------------------------------------------------------- totals */

  const cartInputs: CartLineInput[] = useMemo(
    () =>
      lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        baseUnitPrice: line.baseUnitPrice,
        costPrice: line.costPrice,
        isTaxable: line.isTaxable,
        tiers: (snapshot.products.find((product) => product.id === line.productId)?.tiers ?? []).map((tier) => ({
          minQty: tier.minQty,
          tierUnitPrice: tier.tierUnitPrice,
          label: tier.label,
        })),
      })),
    [lines, snapshot.products],
  );

  const totals = useMemo(
    () =>
      calculateCartTotalsPure({
        lines: cartInputs,
        memberDiscountPct: customer?.discountPct ?? 0,
        promo,
        manualDiscountAmount: manualDiscount,
        paymentMethod,
        tax: { taxRatePct, priceIncludesTax, cashRoundingStep },
      }),
    [cartInputs, customer, promo, manualDiscount, paymentMethod, taxRatePct, priceIncludesTax, cashRoundingStep],
  );

  const manualDiscountPct = totals.subtotal > 0 ? (manualDiscount / totals.subtotal) * 100 : 0;
  const needsPin = manualDiscountPct > cashierDiscountLimitPct + 0.0001;

  const results = useMemo(() => searchCachedProducts(snapshot, query, KEY_CAPACITY), [snapshot, query]);
  const customerResults = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    const pool = snapshot.customers;
    if (!term) return pool.slice(0, 8);
    return pool
      .filter(
        (item) =>
          item.name.toLowerCase().includes(term) ||
          item.memberCode.toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [customerSearch, snapshot.customers]);

  const change = paymentMethod === "CASH" ? computeChangePure(totals.grandTotal, toNumber(cashInput)) : 0;
  const quickCash = useMemo(() => suggestQuickCash(totals.grandTotal), [totals.grandTotal]);

  /* ------------------------------------------------------------ cart edits */

  const addProduct = useCallback((product: CachedProduct, qty = 1) => {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) => (line.productId === product.id ? { ...line, qty: line.qty + qty } : line));
      }
      const resolved = resolveTierPricePure(
        product.retailPrice,
        qty,
        product.tiers.map((tier) => ({ minQty: tier.minQty, tierUnitPrice: tier.tierUnitPrice, label: tier.label })),
      );
      return [
        ...current,
        {
          lineKey: `${product.id}-${Date.now()}`,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          qty,
          baseUnitPrice: product.retailPrice,
          appliedUnitPrice: resolved.appliedUnitPrice,
          costPrice: product.costPrice,
          isTaxable: product.isTaxable,
          tierLabel: resolved.tierLabel,
        },
      ];
    });
    setMessage(null);
  }, []);

  const changeQty = useCallback((productId: string, delta: number) => {
    setLines((current) =>
      current
        .map((line) => (line.productId === productId ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0),
    );
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setCustomer(null);
    setPromo(null);
    setPromoCode("");
    setPromoError(null);
    setManualDiscount(0);
    setSupervisorPin("");
    setCashInput("");
    setSplitCashInput("");
    setReference("");
    setPaymentMethod("CASH");
    setQuery("");
  }, []);

  const commitSearch = useCallback(
    (raw?: string) => {
      const term = (raw ?? query).trim();
      if (!term) return;
      const exact = findCachedProduct(snapshot, term);
      if (exact) {
        addProduct(exact, 1);
        setQuery("");
        setHighlight(0);
        return;
      }
      const found = searchCachedProducts(snapshot, term, KEY_CAPACITY);
      if (found.length === 1 && found[0]) {
        addProduct(found[0], 1);
        setQuery("");
        setHighlight(0);
        return;
      }
      if (!found.length) {
        setMessage({ tone: "warn", text: `Tidak ada produk cocok dengan "${term}" di cache terminal.` });
      }
    },
    [addProduct, query, snapshot],
  );

  /* ------------------------------------------------------------ promo / bill */

  const applyPromo = useCallback(() => {
    const code = promoCode.trim().toUpperCase();
    setPromoError(null);
    if (!code) return;
    const found = snapshot.promos.find((item) => item.code.toUpperCase() === code);
    if (!found) {
      setPromoError("Kode promo tidak aktif di perangkat ini.");
      return;
    }
    if (totals.subtotal < found.minSubtotal) {
      setPromoError(`Butuh belanja minimal ${formatIdr(found.minSubtotal)} untuk promo ${found.code}.`);
      return;
    }
    setPromo({
      code: found.code,
      name: found.name,
      discountType: found.discountType,
      discountValue: found.discountValue,
      minSubtotal: found.minSubtotal,
      maxDiscountCap: found.maxDiscountCap,
    });
    setPanel("NONE");
  }, [promoCode, snapshot.promos, totals.subtotal]);

  const holdBill = useCallback(async () => {
    if (!lines.length) return;
    const bill: HeldBill = {
      id: newClientRequestId(),
      label: customer ? `${customer.name} · ${lines.length} item` : `${lines.length} item · ${formatIdr(totals.grandTotal)}`,
      createdAt: new Date().toISOString(),
      lines,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      note: promo ? `Promo ${promo.code}` : "",
    };
    await offlineDb.saveHeldBill(bill);
    clearCart();
    setPanel("NONE");
    await refreshLocal();
    setMessage({ tone: "ok", text: "Struk ditahan di perangkat. Aman meski tab ditutup atau listrik mati." });
  }, [clearCart, customer, lines, promo, refreshLocal, totals.grandTotal]);

  const resumeHeld = useCallback(
    async (bill: HeldBill) => {
      if (lines.length) {
        setMessage({ tone: "warn", text: "Selesaikan atau kosongkan keranjang aktif sebelum membuka struk tertahan." });
        return;
      }
      setLines(bill.lines.map((line) => ({ ...line, lineKey: `${line.productId}-${Date.now()}` })));
      setCustomer(
        bill.customerId ? snapshot.customers.find((item) => item.id === bill.customerId) ?? null : null,
      );
      await offlineDb.removeHeldBill(bill.id);
      await refreshLocal();
      setPanel("NONE");
    },
    [lines.length, refreshLocal, snapshot.customers],
  );

  /* --------------------------------------------------------------- checkout */

  const openPayment = useCallback(
    (method: PaymentMethod = "CASH") => {
      if (!lines.length) {
        setMessage({ tone: "warn", text: "Keranjang masih kosong." });
        return;
      }
      if (!shiftId) {
        setMessage({ tone: "error", text: "Belum ada shift OPEN. Buka shift dulu di halaman Shift." });
        return;
      }
      if (needsPin) {
        setPanel("SUPERVISOR");
        return;
      }
      setPaymentMethod(method);
      setCashInput(method === "CASH" ? String(totals.grandTotal) : "");
      setSplitCashInput(String(Math.round(totals.grandTotal / 2)));
      setPanel("PAY");
    },
    [lines.length, needsPin, shiftId, totals.grandTotal],
  );

  const finishPayment = useCallback(
    async (options?: { quickExact?: boolean }) => {
      if (!lines.length || !shiftId) return;
      if (needsPin && !supervisorPin.trim()) {
        setPanel("SUPERVISOR");
        return;
      }
      const quickExact = options?.quickExact ?? false;
      const method: PaymentMethod = quickExact ? "CASH" : paymentMethod;
      const total = totals.grandTotal;
      const received = quickExact ? total : method === "CASH" ? toNumber(cashInput) : total;

      if (method === "CASH" && received < total) {
        setMessage({ tone: "error", text: `Uang tunai kurang ${formatIdr(total - received)}.` });
        return;
      }

      const payments =
        method === "SPLIT_PAYMENT"
          ? (() => {
              const cashPart = Math.min(Math.max(0, toNumber(splitCashInput)), total);
              return [
                { method: "CASH" as const, amount: cashPart, reference: null },
                { method: "QRIS" as const, amount: total - cashPart, reference: reference || null },
              ];
            })()
          : [{ method: method as "CASH" | "QRIS" | "DEBIT_CARD", amount: total, reference: reference || null }];

      const clientRequestId = newClientRequestId();
      const createdAt = new Date().toISOString();
      const saleItems = totals.lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        appliedUnitPrice: line.appliedUnitPrice,
      }));

      const promoSnapshot = promo
        ? snapshot.promos.find((item) => item.code === promo.code) ?? null
        : null;

      const buildOutbox = (attempts: number, lastError: string | null): OutboxSale => ({
        clientRequestId,
        createdAt,
        cashierId,
        shiftId,
        terminalId,
        receiptNumber: null,
        customerId: customer?.id ?? null,
        memberDiscountPct: customer?.discountPct ?? 0,
        manualDiscountAmount: manualDiscount,
        promo: promo ? { ...promo, id: promoSnapshot?.id ?? "", code: promo.code, name: promo.name } : null,
        paymentMethod: method,
        cashReceived: received,
        changeGiven: computeChangePure(total, received),
        paymentReference: reference || null,
        payments,
        items: saleItems,
        clientTotal: total,
        grandTotal: total,
        taxAmount: totals.taxAmount,
        tierDiscountTotal: totals.tierDiscountTotal,
        attempts,
        lastError,
      });

      setBusy(true);
      try {
        if (offlineActive) {
          await offlineDb.enqueueSale(buildOutbox(0, null));
          await refreshLocal();
          setMessage({
            tone: "warn",
            text: `Transaksi luring tersimpan: ${formatIdr(total)}. ${queueCount + 1} struk menunggu sinkronisasi.`,
          });
          setLastReceipt({ id: offlineReceiptHref(), number: `OFF-${terminalId}` });
          clearCart();
          setPanel("NONE");
          return;
        }

        const response = await checkoutAction({
          clientRequestId,
          createdAt,
          shiftId,
          customerId: customer?.id ?? null,
          memberDiscountPct: customer?.discountPct ?? 0,
          manualDiscountAmount: manualDiscount,
          supervisorPin: supervisorPin.trim() || undefined,
          promo: promo
            ? {
                id: promoSnapshot?.id ?? null,
                code: promo.code,
                name: promo.name,
                discountType: promo.discountType,
                discountValue: promo.discountValue,
                minSubtotal: promo.minSubtotal,
                maxDiscountCap: promo.maxDiscountCap,
              }
            : null,
          paymentMethod: method,
          cashReceived: method === "CASH" ? received : total,
          paymentReference: reference || null,
          payments,
          items: saleItems,
          clientTotal: total,
        });

        if (!response.ok) {
          setMessage({ tone: "error", text: response.error });
          return;
        }

        setLastReceipt({ id: `/receipt/${response.data.orderId}`, number: response.data.receiptNumber });
        setMessage({
          tone: "ok",
          text: `Pembayaran ${formatIdr(total)} tercatat. Kembalian ${formatIdr(computeChangePure(total, received))}.`,
        });
        clearCart();
        setPanel("NONE");
        setBusy(false);
        // No router.refresh() here: a full RSC refresh on every sale fights the
        // optimistic terminal state and re-runs the page query needlessly.
        return;
      } catch (error) {
        // Network died mid-request: park the sale instead of losing the money.
        await offlineDb.enqueueSale(buildOutbox(1, error instanceof Error ? error.message : "Koneksi gagal"));
        await refreshLocal();
        setMessage({
          tone: "warn",
          text: "Koneksi terputus saat menyimpan. Transaksi dipindah ke antrean offline dan akan disinkronkan.",
        });
        setLastReceipt({ id: offlineReceiptHref(), number: `OFF-${terminalId}` });
        clearCart();
        setPanel("NONE");
      } finally {
        setBusy(false);
      }
    },
    [
      cashInput,
      cashierId,
      clearCart,
      customer,
      lines.length,
      manualDiscount,
      needsPin,
      offlineActive,
      paymentMethod,
      promo,
      queueCount,
      reference,
      refreshLocal,
      router,
      shiftId,
      snapshot.promos,
      splitCashInput,
      supervisorPin,
      terminalId,
      totals,
    ],
  );

  /* ------------------------------------------------------ keyboard shortcuts */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

      switch (event.key) {
        case "F1":
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        case "F2":
          event.preventDefault();
          setPanel("NONE");
          searchRef.current?.focus();
          return;
        case "F3":
          event.preventDefault();
          setPanel("CUSTOMER");
          return;
        case "F4":
          event.preventDefault();
          setPanel("HELD");
          return;
        case "F6":
          event.preventDefault();
          setPanel("PROMO");
          return;
        case "F8":
          event.preventDefault();
          openPayment(paymentMethod);
          return;
        case "F9":
          event.preventDefault();
          void finishPayment({ quickExact: true });
          return;
        case "F10":
          event.preventDefault();
          void holdBill();
          return;
        case "Escape":
          if (panel !== "NONE") {
            event.preventDefault();
            setPanel("NONE");
          } else if (typing) {
            setQuery("");
          }
          return;
        default:
          break;
      }

      if (typing) return;

      if (event.key === "+" || event.key === "-") {
        const last = lines[lines.length - 1];
        if (last) {
          event.preventDefault();
          changeQty(last.productId, event.key === "+" ? 1 : -1);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [changeQty, finishPayment, holdBill, lines, openPayment, panel, paymentMethod]);

  /* ------------------------------------------------------------------- view */

  const statusTone = offlineActive ? "caution" : "grove";
  const statusLabel = offlineActive ? "OFFLINE · IndexedDB" : "ONLINE · tersinkron";

  return (
    <div className="space-y-4">
      {/* Terminal header */}
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div>
              <p className="label-xs">Terminal</p>
              <p className="num text-[0.875rem] font-semibold">{terminalId}</p>
            </div>
            <div>
              <p className="label-xs">Kasir</p>
              <p className="text-[0.875rem] font-medium">{cashierName}</p>
            </div>
            <div>
              <p className="label-xs">Shift</p>
              <p className="num text-[0.875rem]">{shiftNumber ?? "belum dibuka"}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMode((value) => (value === "ONLINE" ? "OFFLINE" : "ONLINE"))}
              className={`btn ${offlineActive ? "btn-accent" : "btn-ghost"}`}
              aria-pressed={offlineActive}
              title="Simulasi putus jaringan: seluruh transaksi dilayani dari IndexedDB"
            >
              {offlineActive ? <WifiOff size={14} /> : <Wifi size={14} />}
              {offlineActive ? "Mode Offline Aktif" : "Simulasi Putus Jaringan"}
            </button>

            <Link href="/pos/sync" className="btn btn-ghost">
              <CircleAlert size={14} className={queueCount ? "text-flame-600" : ""} />
              Antrean
              <span className="num rounded-xs bg-ink-100 px-1.5 py-0.5 text-[0.6875rem]">{queueCount}</span>
            </Link>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-2.5">
          <Badge tone={statusTone}>{statusLabel}</Badge>
          {heldBills.length ? <Badge tone="signal">{heldBills.length} struk tertahan</Badge> : null}
          <span className="text-[0.6875rem] text-ink-500">
            Cache katalog: {snapshot.products.length} produk · {snapshot.customers.length} member ·{" "}
            {snapshot.promos.length} promo
          </span>
          <span className="ml-auto hidden text-[0.6875rem] text-ink-500 md:inline">
            <span className="kbd">F1</span> cari · <span className="kbd">F2</span> pindai · <span className="kbd">F3</span> member ·{" "}
            <span className="kbd">F4</span> tahan · <span className="kbd">F8</span> bayar · <span className="kbd">F9</span> uang pas
          </span>
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-md border px-3.5 py-2.5 text-[0.8125rem] ${
            message.tone === "ok"
              ? "border-grove-100 bg-grove-100 text-grove-700"
              : message.tone === "warn"
                ? "border-caution-100 bg-caution-100 text-caution-700"
                : "border-alert-100 bg-alert-100 text-alert-700"
          }`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="shrink-0" aria-label="Tutup pesan">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {lastReceipt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-200 bg-paper px-3.5 py-2.5 text-[0.8125rem]">
          <Check size={15} className="text-grove-600" />
          <span>
            Struk <span className="num font-medium">{lastReceipt.number}</span> siap.
          </span>
          {lastReceipt.id ? (
            <a
              href={lastReceipt.id}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost ml-auto py-1 text-[0.75rem]"
            >
              <Printer size={13} /> Cetak struk
            </a>
          ) : (
            <span className="ml-auto text-[0.75rem] text-ink-500">
              Struk luring bisa dicetak setelah sinkronisasi.
            </span>
          )}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* --------------------------------------------------------- left: cart */}
        <div className="min-w-0 space-y-4">
          <section className="panel min-w-0 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <Search size={15} className="shrink-0 text-ink-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitSearch();
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setHighlight((value) => Math.min(value + 1, results.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight((value) => Math.max(value - 1, 0));
                  }
                }}
                placeholder="Pindai barcode, ketik SKU atau nama produk…"
                className="min-w-0 flex-1 basis-0 bg-transparent px-0 py-1 font-mono text-[0.9375rem] outline-none placeholder:text-ink-400"
                aria-label="Cari produk atau pindai barcode"
                autoComplete="off"
              />
              <span className="kbd shrink-0 text-ink-400">F2</span>
            </div>

            {results.length ? (
              <ul className="mt-2.5 grid min-w-0 gap-1 border-t border-ink-100 pt-2.5 sm:grid-cols-2">
                {results.map((product, index) => {
                  const preview = resolveTierPricePure(
                    product.retailPrice,
                    1,
                    product.tiers.map((tier) => ({ minQty: tier.minQty, tierUnitPrice: tier.tierUnitPrice, label: tier.label })),
                  );
                  return (
                    <li key={product.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          addProduct(product, 1);
                          setQuery("");
                        }}
                        onMouseEnter={() => setHighlight(index)}
                        className={`flex w-full min-w-0 items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-left transition-colors ${
                          highlight === index ? "bg-ink-100" : "hover:bg-ink-50"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.8125rem] font-medium">{product.name}</span>
                          <span className="num block truncate text-[0.6875rem] text-ink-500">
                            {product.sku} · stok {product.stockOnHand} {product.unit}
                          </span>
                        </span>
                        <Money value={preview.appliedUnitPrice} className="shrink-0 text-[0.8125rem]" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-2.5">
              <h2 className="text-[0.9375rem] font-semibold">
                Keranjang
                <span className="num ml-2 text-[0.8125rem] font-normal text-ink-500">{totals.itemCount} item</span>
              </h2>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={holdBill} disabled={!lines.length} className="btn btn-ghost py-1 text-[0.75rem]">
                  <Pause size={13} /> Tahan (F10)
                </button>
                <button type="button" onClick={() => setPanel("HELD")} className="btn btn-ghost py-1 text-[0.75rem]">
                  <ShoppingBag size={13} /> Tertahan {heldBills.length ? `(${heldBills.length})` : ""}
                </button>
                <button
                  type="button"
                  onClick={clearCart}
                  disabled={!lines.length}
                  className="btn btn-ghost py-1 text-[0.75rem]"
                >
                  <Trash2 size={13} /> Kosongkan
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="px-4 py-10">
                <p className="text-[0.875rem] font-medium">Keranjang kosong</p>
                <p className="mt-1 max-w-[62ch] text-[0.8125rem] text-ink-500">
                  Pindai barcode atau ketik nama produk. Keranjang disimpan di memori perangkat dan aman selama sesi.
                  Tekan <span className="kbd">F2</span> untuk siap memindai.
                </p>
              </div>
            ) : (
              <div className="scroll-thin max-h-[46vh] overflow-auto">
                <table className="data-table min-w-[30rem]">
                  <thead className="sticky top-0 z-10 bg-paper">
                    <tr>
                      <th>Produk</th>
                      <th className="text-right">Harga</th>
                      <th className="text-center">Qty</th>
                      <th className="text-right">Subtotal</th>
                      <th aria-label="Aksi" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const preview = resolveTierPricePure(
                        line.baseUnitPrice,
                        line.qty,
                        (snapshot.products.find((product) => product.id === line.productId)?.tiers ?? []).map((tier) => ({
                          minQty: tier.minQty,
                          tierUnitPrice: tier.tierUnitPrice,
                          label: tier.label,
                        })),
                      );
                      return (
                        <tr key={line.lineKey}>
                          <td>
                            <span className="block text-[0.8125rem] font-medium">{line.name}</span>
                            <span className="num block text-[0.6875rem] text-ink-500">{line.sku}</span>
                            {preview.tierLabel ? (
                              <span className="tag tag-accent mt-1">Harga grosir aktif</span>
                            ) : null}
                          </td>
                          <td className="text-right">
                            <Money value={preview.appliedUnitPrice} className="text-[0.8125rem]" />
                            {preview.appliedUnitPrice < line.baseUnitPrice ? (
                              <span className="num block text-[0.6875rem] text-ink-400 line-through">
                                {formatIdr(line.baseUnitPrice)}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => changeQty(line.productId, -1)}
                                className="flex h-6 w-6 items-center justify-center rounded-xs border border-ink-200 text-ink-600 hover:bg-ink-50"
                                aria-label={`Kurangi ${line.name}`}
                              >
                                <Minus size={12} />
                              </button>
                              <span className="num w-7 text-center text-[0.8125rem] font-medium">{line.qty}</span>
                              <button
                                type="button"
                                onClick={() => changeQty(line.productId, 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-xs border border-ink-200 text-ink-600 hover:bg-ink-50"
                                aria-label={`Tambah ${line.name}`}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          </td>
                          <td className="num text-right text-[0.8125rem] font-medium">
                            {formatIdr(preview.appliedUnitPrice * line.qty)}
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() => setLines((current) => current.filter((row) => row.lineKey !== line.lineKey))}
                              className="btn-quiet"
                              aria-label={`Hapus ${line.name}`}
                            >
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ------------------------------------------------------ right: summary */}
        <aside className="min-w-0 space-y-3 lg:sticky lg:top-16 lg:self-start">
          <section className="panel px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="label-xs">Pelanggan</p>
              <button type="button" onClick={() => setPanel("CUSTOMER")} className="btn-quiet text-[0.75rem]">
                {customer ? "Ganti" : "Pilih"} (F3)
              </button>
            </div>
            {customer ? (
              <div className="mt-1.5">
                <p className="text-[0.875rem] font-medium">{customer.name}</p>
                <p className="num text-[0.6875rem] text-ink-500">
                  {customer.memberCode} · {customer.tier} · diskon {customer.discountPct}%
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-[0.8125rem] text-ink-500">Tanpa member (harga umum)</p>
            )}
          </section>

          <section className="panel px-4 py-4">
            <dl className="space-y-1.5 text-[0.8125rem]">
              <div className="flex justify-between">
                <dt className="text-ink-600">Subtotal</dt>
                <dd className="num">{formatIdr(totals.subtotal)}</dd>
              </div>
              {totals.tierDiscountTotal > 0 ? (
                <div className="flex justify-between text-grove-700">
                  <dt>Hemat harga grosir</dt>
                  <dd className="num">-{formatIdr(totals.tierDiscountTotal)}</dd>
                </div>
              ) : null}
              {totals.memberDiscountAmount > 0 ? (
                <div className="flex justify-between text-grove-700">
                  <dt>Diskon member</dt>
                  <dd className="num">-{formatIdr(totals.memberDiscountAmount)}</dd>
                </div>
              ) : null}
              {totals.promoDiscountAmount > 0 ? (
                <div className="flex justify-between text-grove-700">
                  <dt>Promo {promo?.code}</dt>
                  <dd className="num">-{formatIdr(totals.promoDiscountAmount)}</dd>
                </div>
              ) : null}
              {totals.manualDiscountAmount > 0 ? (
                <div className="flex justify-between text-grove-700">
                  <dt>Diskon manual</dt>
                  <dd className="num">-{formatIdr(totals.manualDiscountAmount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-ink-100 pt-1.5">
                <dt className="text-ink-600">DPP</dt>
                <dd className="num">{formatIdr(totals.taxableBase)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">
                  PPN {taxRatePct}% {priceIncludesTax ? "(termasuk)" : ""}
                </dt>
                <dd className="num">{formatIdr(totals.taxAmount)}</dd>
              </div>
              {totals.roundingAdjustment !== 0 ? (
                <div className="flex justify-between text-ink-500">
                  <dt>Pembulatan tunai</dt>
                  <dd className="num">{formatIdr(totals.roundingAdjustment)}</dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
              <span className="text-[0.8125rem] font-medium">Total</span>
              <span className="num text-[1.5rem] font-semibold leading-none">{formatIdr(totals.grandTotal)}</span>
            </div>

            <div className="mt-3 grid gap-1.5">
              <button type="button" onClick={() => openPayment("CASH")} disabled={!lines.length || busy} className="btn btn-accent w-full">
                <Banknote size={15} /> Bayar (F8)
              </button>
              <button
                type="button"
                onClick={() => void finishPayment({ quickExact: true })}
                disabled={!lines.length || busy}
                className="btn btn-primary w-full"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                Uang Pas (F9)
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setPanel("PROMO")} className="btn btn-ghost">
                  Promo (F6)
                </button>
                <button type="button" onClick={() => setPanel("DRAWER")} className="btn btn-ghost">
                  Laci kas
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {/* ------------------------------------------------------------- panels */}
      {panel !== "NONE" ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/45 px-3 py-8"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPanel("NONE");
          }}
        >
          <div className="panel w-full max-w-[34rem] px-5 py-5">
            {panel === "PAY" ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="label-xs">Pembayaran</p>
                    <p className="num mt-1 text-[1.5rem] font-semibold leading-none">{formatIdr(totals.grandTotal)}</p>
                  </div>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(
                    [
                      { key: "CASH", label: "Tunai", icon: Banknote },
                      { key: "QRIS", label: "QRIS", icon: QrCode },
                      { key: "DEBIT_CARD", label: "Kartu", icon: CreditCard },
                      { key: "SPLIT_PAYMENT", label: "Split", icon: ShieldCheck },
                    ] as const
                  ).map((option) => {
                    const Icon = option.icon;
                    const active = paymentMethod === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setPaymentMethod(option.key)}
                        aria-pressed={active}
                        className={`flex flex-col items-center gap-1 rounded-sm border px-2 py-2.5 text-[0.75rem] font-medium transition-colors ${
                          active
                            ? "border-ink-900 bg-ink-900 text-paper"
                            : "border-ink-200 text-ink-700 hover:bg-ink-50"
                        }`}
                      >
                        <Icon size={16} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {paymentMethod === "CASH" ? (
                  <div>
                    <label className="label-xs" htmlFor="cash-input">
                      Uang diterima
                    </label>
                    <input
                      id="cash-input"
                      value={cashInput}
                      onChange={(event) => setCashInput(event.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      className="field field-mono mt-1.5 text-[1.125rem]"
                      placeholder="0"
                      autoFocus
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {quickCash.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setCashInput(String(amount))}
                          className="num rounded-xs border border-ink-200 px-2 py-1 text-[0.75rem] hover:bg-ink-100"
                        >
                          {formatIdr(amount)}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between rounded-sm bg-ink-50 px-3 py-2">
                      <span className="text-[0.8125rem] text-ink-600">Kembalian</span>
                      <span className="num text-[1rem] font-semibold">{formatIdr(change)}</span>
                    </div>
                  </div>
                ) : null}

                {paymentMethod === "SPLIT_PAYMENT" ? (
                  <div className="grid gap-2.5">
                    <label className="block">
                      <span className="label-xs">Porsi tunai</span>
                      <input
                        value={splitCashInput}
                        onChange={(event) => setSplitCashInput(event.target.value.replace(/[^\d]/g, ""))}
                        inputMode="numeric"
                        className="field field-mono mt-1.5"
                      />
                    </label>
                    <div className="flex items-center justify-between rounded-sm bg-ink-50 px-3 py-2 text-[0.8125rem]">
                      <span>Sisa lewat QRIS</span>
                      <span className="num font-semibold">
                        {formatIdr(Math.max(0, totals.grandTotal - toNumber(splitCashInput)))}
                      </span>
                    </div>
                  </div>
                ) : null}

                {paymentMethod === "QRIS" || paymentMethod === "DEBIT_CARD" || paymentMethod === "SPLIT_PAYMENT" ? (
                  <label className="block">
                    <span className="label-xs">Nomor referensi (opsional)</span>
                    <input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      className="field field-mono mt-1.5"
                      placeholder={paymentMethod === "QRIS" ? "ID transaksi QRIS" : "Nomor approval EDC"}
                    />
                  </label>
                ) : null}

                <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
                  <button type="button" onClick={() => setPanel("NONE")} className="btn btn-ghost">
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => void finishPayment()}
                    disabled={busy}
                    className="btn btn-accent ml-auto"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {offlineActive ? "Simpan ke antrean" : "Selesaikan pembayaran"}
                  </button>
                </div>
              </div>
            ) : null}

            {panel === "CUSTOMER" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[1rem]">Pilih pelanggan</h2>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>
                <input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  className="field"
                  placeholder="Nama atau kode member…"
                  autoFocus
                />
                <ul className="scroll-thin max-h-[40vh] divide-y divide-ink-100 overflow-y-auto">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(null);
                        setPanel("NONE");
                      }}
                      className="w-full px-1 py-2 text-left text-[0.8125rem] hover:bg-ink-50"
                    >
                      Tanpa member
                    </button>
                  </li>
                  {customerResults.map((member) => (
                    <li key={member.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomer(member);
                          setPanel("NONE");
                        }}
                        className="flex w-full items-baseline justify-between gap-3 px-1 py-2 text-left hover:bg-ink-50"
                      >
                        <span>
                          <span className="block text-[0.8125rem] font-medium">{member.name}</span>
                          <span className="num block text-[0.6875rem] text-ink-500">{member.memberCode}</span>
                        </span>
                        <span className="tag tag-neutral">
                          {member.tier} · {member.discountPct}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {panel === "PROMO" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[1rem]">Promo & diskon manual</h2>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    value={promoCode}
                    onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                    className="field field-mono"
                    placeholder="KODE PROMO"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyPromo();
                      }
                    }}
                  />
                  <button type="button" onClick={applyPromo} className="btn btn-primary shrink-0">
                    Terapkan
                  </button>
                </div>
                {promoError ? <p className="text-[0.8125rem] text-alert-700">{promoError}</p> : null}
                {promo ? (
                  <div className="flex items-center justify-between rounded-sm bg-grove-100 px-3 py-2 text-[0.8125rem] text-grove-700">
                    <span>
                      {promo.code} · {promo.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPromo(null);
                        setPromoCode("");
                      }}
                      className="text-[0.75rem] underline"
                    >
                      Lepas
                    </button>
                  </div>
                ) : null}

                <div className="border-t border-ink-100 pt-3">
                  <label className="label-xs" htmlFor="manual-discount">
                    Diskon manual (Rp)
                  </label>
                  <input
                    id="manual-discount"
                    value={manualDiscount || ""}
                    onChange={(event) => setManualDiscount(toNumber(event.target.value.replace(/[^\d]/g, "")))}
                    inputMode="numeric"
                    className="field field-mono mt-1.5"
                    placeholder="0"
                  />
                  <p className="mt-1.5 text-[0.75rem] text-ink-500">
                    Batas kasir {cashierDiscountLimitPct}% dari subtotal. Di atas itu butuh PIN Supervisor.
                  </p>
                  {needsPin ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-caution-700">
                      <CircleAlert size={13} />
                      Diskon {manualDiscountPct.toFixed(1)}% melebihi batas — PIN Supervisor akan diminta.
                    </p>
                  ) : null}
                </div>

                <div className="flex justify-end border-t border-ink-100 pt-3">
                  <button type="button" onClick={() => setPanel("NONE")} className="btn btn-primary">
                    Simpan pengaturan
                  </button>
                </div>
              </div>
            ) : null}

            {panel === "SUPERVISOR" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[1rem]">Otorisasi Supervisor</h2>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>
                <p className="text-[0.8125rem] text-ink-600">
                  Diskon manual {formatIdr(manualDiscount)} ({manualDiscountPct.toFixed(1)}%) melebihi batas kasir{" "}
                  {cashierDiscountLimitPct}%. Minta supervisor memasukkan PIN 6 digit.
                </p>
                <input
                  value={supervisorPin}
                  onChange={(event) => setSupervisorPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  className="field field-mono text-center text-[1.25rem] tracking-[0.4em]"
                  placeholder="••••••"
                  autoFocus
                />
                <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
                  <button type="button" onClick={() => setPanel("NONE")} className="btn btn-ghost">
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={supervisorPin.length !== 6}
                    onClick={() => {
                      setPanel("PAY");
                      void finishPayment();
                    }}
                    className="btn btn-accent ml-auto"
                  >
                    <ShieldCheck size={15} /> Otorisasi & bayar
                  </button>
                </div>
              </div>
            ) : null}

            {panel === "HELD" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[1rem]">Struk tertahan</h2>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>
                {heldBills.length === 0 ? (
                  <p className="text-[0.8125rem] text-ink-500">
                    Belum ada struk tertahan. Tekan <span className="kbd">F10</span> untuk menahan keranjang aktif.
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {heldBills.map((bill) => (
                      <li key={bill.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[0.8125rem] font-medium">{bill.label}</p>
                          <p className="num text-[0.6875rem] text-ink-500">
                            {new Date(bill.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                            {bill.lines.length} baris
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => void resumeHeld(bill)} className="btn btn-ghost py-1 text-[0.75rem]">
                            Buka
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await offlineDb.removeHeldBill(bill.id);
                              await refreshLocal();
                            }}
                            className="btn-quiet"
                            aria-label="Hapus struk tertahan"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {panel === "DRAWER" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[1rem]">Laci kas</h2>
                  <button type="button" onClick={() => setPanel("NONE")} className="btn-quiet" aria-label="Tutup">
                    <X size={15} />
                  </button>
                </div>
                <p className="text-[0.8125rem] text-ink-600">
                  Kas masuk/keluar dan tutup shift dikelola di halaman Shift. Angka uang yang seharusnya ada di laci
                  sengaja tidak ditampilkan di terminal.
                </p>
                <div className="flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
                  <Link href={`/shifts${shiftId ? `/${shiftId}` : ""}`} className="btn btn-primary">
                    <Banknote size={15} /> Buka halaman shift
                  </Link>
                  <Link href="/pos/sync" className="btn btn-ghost">
                    Antrean sinkronisasi
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}


