"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { approveOpnameAction, createOpnameAction, receiveStockAction, rejectOpnameAction } from "@/app/actions/admin";
import { formatIdr, toNumber } from "@/lib/format";

type Option = { id: string; name: string; sku: string; stockOnHand: number; costPrice: number };

export function ReceivingForm({ products, suppliers }: { products: Option[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<{ productId: string; qty: string; unitCost: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const total = rows.reduce((sum, row) => sum + toNumber(row.qty) * toNumber(row.unitCost), 0);

  function updateRow(index: number, patch: Partial<{ productId: string; qty: string; unitCost: string }>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await receiveStockAction({
      supplierId,
      notes,
      items: rows
        .filter((row) => row.productId && toNumber(row.qty) > 0 && toNumber(row.unitCost) > 0)
        .map((row) => ({ productId: row.productId, qty: toNumber(row.qty), unitCost: toNumber(row.unitCost) })),
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `Penerimaan ${result.data.receiptNumber} tercatat. Modal ${formatIdr(result.data.totalAmount)} masuk ke HPP rata-rata tertimbang.`,
    });
    setRows([]);
    setNotes("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-xs">Supplier</span>
          <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="field mt-1.5">
            <option value="">Tanpa supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-xs">Catatan</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className="field mt-1.5" placeholder="Nomor surat jalan, kondisi barang" />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[0.875rem] font-medium">Item diterima</p>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, { productId: products[0]?.id ?? "", qty: "", unitCost: "" }])}
            className="btn btn-ghost py-1 text-[0.75rem]"
          >
            <Plus size={13} /> Tambah baris
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-ink-500">Tambahkan minimal satu baris barang yang diterima.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {rows.map((row, index) => {
              const product = products.find((item) => item.id === row.productId);
              return (
                <li key={index} className="grid grid-cols-[1.6fr_0.7fr_0.9fr_auto] items-end gap-1.5">
                  <label className="block">
                    <span className="label-xs">Produk</span>
                    <select value={row.productId} onChange={(event) => updateRow(index, { productId: event.target.value })} className="field mt-1">
                      {products.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label-xs">Qty</span>
                    <input
                      value={row.qty}
                      onChange={(event) => updateRow(index, { qty: event.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      className="field field-mono mt-1"
                      placeholder="0"
                    />
                  </label>
                  <label className="block">
                    <span className="label-xs">Harga beli/unit</span>
                    <input
                      value={row.unitCost}
                      onChange={(event) => updateRow(index, { unitCost: event.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      className="field field-mono mt-1"
                      placeholder={String(product?.costPrice ?? 0)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="btn-quiet mb-0.5"
                    aria-label="Hapus baris"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3">
        <button type="submit" disabled={busy || rows.length === 0} className="btn btn-accent">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Simpan penerimaan
        </button>
        <span className="num text-[0.8125rem] text-ink-600">Total modal: {formatIdr(total)}</span>
        {feedback ? (
          <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>{feedback.text}</p>
        ) : null}
      </div>
    </form>
  );
}

export function OpnameForm({ products }: { products: Option[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const entries = Object.entries(counts).filter(([, value]) => value !== "" && value !== undefined);
  const varianceValue = entries.reduce((sum, [productId, value]) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return sum;
    return sum + (toNumber(value) - product.stockOnHand) * product.costPrice;
  }, 0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await createOpnameAction({
      notes,
      items: entries.map(([productId, value]) => ({ productId, physicalQtyCounted: toNumber(value) })),
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `Opname ${result.data.opnameNumber} dikirim untuk persetujuan. Nilai selisih ${formatIdr(result.data.varianceValue)}.`,
    });
    setCounts({});
    setNotes("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[0.8125rem] text-ink-600">
        Isi hanya produk yang benar-benar dihitung. Stok sistem tidak berubah sampai manajer menyetujui dokumen ini.
      </p>
      <label className="block">
        <span className="label-xs">Catatan opname</span>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} className="field mt-1.5" placeholder="Contoh: hitung rak minuman, 3 unit rusak" />
      </label>

      <div className="scroll-thin max-h-[26rem] overflow-y-auto rounded-md border border-ink-100">
        <table className="data-table">
          <thead className="sticky top-0 bg-paper">
            <tr>
              <th>Produk</th>
              <th className="text-right">Stok sistem</th>
              <th className="text-right">Hitung fisik</th>
              <th className="text-right">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const raw = counts[product.id];
              const counted = raw === undefined || raw === "" ? null : toNumber(raw);
              const delta = counted === null ? null : counted - product.stockOnHand;
              return (
                <tr key={product.id}>
                  <td>
                    <span className="block text-[0.8125rem]">{product.name}</span>
                    <span className="num block text-[0.6875rem] text-ink-500">{product.sku}</span>
                  </td>
                  <td className="num text-right text-[0.8125rem]">{product.stockOnHand}</td>
                  <td className="text-right">
                    <input
                      value={raw ?? ""}
                      onChange={(event) => {
                        const value = event.target.value.replace(/[^\d]/g, "");
                        setCounts((current) => ({ ...current, [product.id]: value }));
                      }}
                      inputMode="numeric"
                      className="field field-mono w-20 text-center"
                      placeholder="—"
                      aria-label={`Hitung fisik ${product.name}`}
                    />
                  </td>
                  <td className={`num text-right text-[0.8125rem] ${delta === null ? "text-ink-400" : delta < 0 ? "text-alert-700" : delta > 0 ? "text-grove-700" : ""}`}>
                    {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3">
        <button type="submit" disabled={busy || entries.length === 0} className="btn btn-accent">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Kirim opname
        </button>
        <span className="num text-[0.8125rem] text-ink-600">
          {entries.length} produk dihitung · nilai selisih {formatIdr(varianceValue)}
        </span>
        {feedback ? (
          <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>{feedback.text}</p>
        ) : null}
      </div>
    </form>
  );
}

export function OpnameApproval({ opnameId, status }: { opnameId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [mode, setMode] = useState<"NONE" | "REJECT">("NONE");

  const pending = status === "DRAFT" || status === "SUBMITTED";

  return (
    <div className="space-y-2">
      {pending ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await approveOpnameAction({ opnameId });
              setBusy(false);
              setFeedback(result.ok ? `${result.data.adjusted} produk disesuaikan.` : result.error);
              router.refresh();
            }}
            className="btn btn-accent"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Setujui & sesuaikan stok
          </button>
          <button type="button" onClick={() => setMode(mode === "REJECT" ? "NONE" : "REJECT")} className="btn btn-ghost">
            Tolak
          </button>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-ink-500">Dokumen ini sudah {status.toLowerCase()}.</p>
      )}

      {mode === "REJECT" ? (
        <div className="flex gap-2">
          <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="field" placeholder="Alasan penolakan" />
          <button
            type="button"
            disabled={busy || !rejectReason.trim()}
            onClick={async () => {
              setBusy(true);
              const result = await rejectOpnameAction({ opnameId, reason: rejectReason });
              setBusy(false);
              setFeedback(result.ok ? "Dokumen ditolak." : result.error);
              router.refresh();
            }}
            className="btn btn-danger shrink-0"
          >
            Kirim penolakan
          </button>
        </div>
      ) : null}

      {feedback ? <p className="text-[0.8125rem] text-ink-700">{feedback}</p> : null}
    </div>
  );
}
