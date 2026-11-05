"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveProductAction } from "@/app/actions/admin";
import { formatIdr, toNumber } from "@/lib/format";

type Tier = { minQty: number; tierUnitPrice: number; label: string };

export function ProductForm({
  categories,
  product,
}: {
  categories: { id: string; name: string }[];
  product?: {
    id: string;
    sku: string;
    barcode: string | null;
    name: string;
    categoryId: string | null;
    unit: string;
    costPrice: number;
    retailPrice: number;
    minMarginPct: number;
    reorderPoint: number;
    reorderQty: number;
    isTaxable: boolean;
    isActive: boolean;
    tiers: Tier[];
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    unit: product?.unit ?? "PCS",
    costPrice: String(product?.costPrice ?? ""),
    retailPrice: String(product?.retailPrice ?? ""),
    minMarginPct: String(product?.minMarginPct ?? "10"),
    reorderPoint: String(product?.reorderPoint ?? "0"),
    reorderQty: String(product?.reorderQty ?? "0"),
    isTaxable: product?.isTaxable ?? true,
    isActive: product?.isActive ?? true,
  });
  const [tiers, setTiers] = useState<Tier[]>(product?.tiers ?? []);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const cost = toNumber(form.costPrice);
  const retail = toNumber(form.retailPrice);
  const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await saveProductAction({
      id: product?.id,
      sku: form.sku,
      barcode: form.barcode,
      name: form.name,
      categoryId: form.categoryId,
      unit: form.unit,
      costPrice: toNumber(form.costPrice),
      retailPrice: toNumber(form.retailPrice),
      minMarginPct: toNumber(form.minMarginPct),
      reorderPoint: toNumber(form.reorderPoint),
      reorderQty: toNumber(form.reorderQty),
      isTaxable: form.isTaxable,
      isActive: form.isActive,
      tiers,
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({ tone: "ok", text: product ? "Produk diperbarui." : "Produk baru dibuat." });
    if (!product) {
      setForm((current) => ({ ...current, sku: "", barcode: "", name: "", costPrice: "", retailPrice: "" }));
      setTiers([]);
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-xs">SKU</span>
          <input value={form.sku} onChange={(event) => update("sku", event.target.value)} className="field field-mono mt-1.5" required />
        </label>
        <label className="block">
          <span className="label-xs">Barcode (EAN-13, opsional)</span>
          <input value={form.barcode} onChange={(event) => update("barcode", event.target.value)} className="field field-mono mt-1.5" placeholder="899…" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-xs">Nama produk</span>
          <input value={form.name} onChange={(event) => update("name", event.target.value)} className="field mt-1.5" required />
        </label>
        <label className="block">
          <span className="label-xs">Kategori</span>
          <select value={form.categoryId} onChange={(event) => update("categoryId", event.target.value)} className="field mt-1.5">
            <option value="">Tanpa kategori</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-xs">Satuan</span>
          <select value={form.unit} onChange={(event) => update("unit", event.target.value)} className="field mt-1.5">
            {["PCS", "BOX", "PACK", "SAK", "SCH", "BOT", "PCH", "KG", "LTR"].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-xs">HPP saat ini (Rp)</span>
          <input
            value={form.costPrice}
            onChange={(event) => update("costPrice", event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="field field-mono mt-1.5"
            required
          />
        </label>
        <label className="block">
          <span className="label-xs">Harga eceran (Rp)</span>
          <input
            value={form.retailPrice}
            onChange={(event) => update("retailPrice", event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="field field-mono mt-1.5"
            required
          />
          <span className="mt-1 block text-[0.6875rem] text-ink-500">
            Margin sekarang {margin.toFixed(1)}% dari harga jual
          </span>
        </label>
        <label className="block">
          <span className="label-xs">Margin minimum (%)</span>
          <input
            value={form.minMarginPct}
            onChange={(event) => update("minMarginPct", event.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            className="field field-mono mt-1.5"
          />
        </label>
        <label className="block">
          <span className="label-xs">Titik pesan ulang (unit)</span>
          <input
            value={form.reorderPoint}
            onChange={(event) => update("reorderPoint", event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="field field-mono mt-1.5"
          />
        </label>
        <label className="block">
          <span className="label-xs">Jumlah pesan ulang (unit)</span>
          <input
            value={form.reorderQty}
            onChange={(event) => update("reorderQty", event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="field field-mono mt-1.5"
          />
        </label>
        {product ? (
          <label className="block">
            <span className="label-xs">Stok saat ini</span>
            <p className="num mt-1.5 text-[1.125rem] font-semibold">{product.reorderPoint >= 0 ? "" : ""}</p>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 text-[0.8125rem]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.isTaxable} onChange={(event) => update("isTaxable", event.target.checked)} />
          Kena PPN
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
          Aktif dijual
        </label>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.875rem] font-medium">Harga bertingkat / grosir</p>
            <p className="text-[0.75rem] text-ink-500">
              Terminal otomatis memakai harga terendah yang syarat kuantitasnya terpenuhi.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTiers((current) => [...current, { minQty: 6, tierUnitPrice: Math.max(0, retail - 100), label: `Grosir ${6} pcs` }])}
            className="btn btn-ghost py-1 text-[0.75rem]"
          >
            <Plus size={13} /> Tambah tier
          </button>
        </div>

        {tiers.length ? (
          <ul className="mt-2.5 space-y-1.5">
            {tiers.map((tier, index) => (
              <li key={index} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-1.5">
                <label className="block">
                  <span className="label-xs">Min qty</span>
                  <input
                    value={tier.minQty}
                    onChange={(event) => {
                      const value = toNumber(event.target.value.replace(/[^\d]/g, ""));
                      setTiers((current) => current.map((row, i) => (i === index ? { ...row, minQty: value } : row)));
                    }}
                    inputMode="numeric"
                    className="field field-mono mt-1"
                  />
                </label>
                <label className="block">
                  <span className="label-xs">Harga satuan</span>
                  <input
                    value={tier.tierUnitPrice}
                    onChange={(event) => {
                      const value = toNumber(event.target.value.replace(/[^\d]/g, ""));
                      setTiers((current) => current.map((row, i) => (i === index ? { ...row, tierUnitPrice: value } : row)));
                    }}
                    inputMode="numeric"
                    className="field field-mono mt-1"
                  />
                </label>
                <label className="block">
                  <span className="label-xs">Label</span>
                  <input
                    value={tier.label}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTiers((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)));
                    }}
                    className="field mt-1"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                  className="btn-quiet mb-0.5"
                  aria-label="Hapus tier"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[0.75rem] text-ink-500">Belum ada harga grosir. Produk ini hanya memakai harga eceran.</p>
        )}
        {tiers.length ? (
          <p className="mt-2 text-[0.75rem] text-ink-500">
            Contoh: beli {tiers[0]?.minQty ?? 6} unit → {formatIdr(tiers[0]?.tierUnitPrice ?? 0)} per unit.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
        <button type="submit" disabled={busy} className="btn btn-accent">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {product ? "Simpan perubahan" : "Buat produk"}
        </button>
        {feedback ? (
          <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>
            {feedback.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
