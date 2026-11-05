"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Undo2 } from "lucide-react";
import { refundOrderAction, voidOrderAction } from "@/app/actions/pos";
import { formatIdr, toNumber } from "@/lib/format";

type Item = {
  id: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  qty: number;
  refundedQty: number;
  appliedUnitPrice: string | number;
};

export function OrderActions({
  orderId,
  status,
  items,
  canAct,
}: {
  orderId: string;
  status: string;
  items: Item[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"NONE" | "VOID" | "REFUND">("NONE");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!canAct) {
    return (
      <p className="text-[0.8125rem] text-ink-500">
        Void dan retur butuh supervisor. Minta manajer menyetujui dari akun mereka.
      </p>
    );
  }

  if (status === "VOIDED") {
    return <p className="text-[0.8125rem] text-ink-500">Struk ini sudah void. Stok sudah dikembalikan.</p>;
  }

  const refundable = items.filter((item) => item.qty - item.refundedQty > 0);

  async function submitVoid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await voidOrderAction({ orderId, supervisorPin: pin, reason });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({ tone: "ok", text: `Struk ${result.data.receiptNumber} di-void. ${result.data.restoredItems} item dikembalikan ke stok.` });
    setPin("");
    setReason("");
    router.refresh();
  }

  async function submitRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lines = Object.entries(qty)
      .map(([itemId, value]) => ({ itemId, qty: toNumber(value) }))
      .filter((line) => line.qty > 0);
    if (!lines.length) {
      setFeedback({ tone: "error", text: "Pilih minimal satu item dan jumlah retur." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await refundOrderAction({ orderId, supervisorPin: pin, reason, restockItems: restock, lines });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `Retur ${result.data.returnNumber} tercatat: ${formatIdr(result.data.refundAmount)} (${result.data.status.replace(/_/g, " ")}).`,
    });
    setQty({});
    setPin("");
    setReason("");
    router.refresh();
  }

  if (mode === "NONE") {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("VOID")} className="btn btn-danger">
          <ShieldCheck size={15} /> Void struk
        </button>
        <button type="button" onClick={() => setMode("REFUND")} className="btn btn-ghost">
          <Undo2 size={15} /> Retur / refund
        </button>
        {feedback ? (
          <p className={`w-full text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>
            {feedback.text}
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === "VOID") {
    return (
      <form onSubmit={submitVoid} className="space-y-3">
        <div className="rounded-md border border-alert-100 bg-alert-100 px-3.5 py-2.5 text-[0.8125rem] text-alert-700">
          Void membatalkan seluruh struk dan mengembalikan semua item ke stok. Uang tunai harus dikembalikan ke
          pelanggan secara manual.
        </div>
        <label className="block">
          <span className="label-xs">Alasan void</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="field mt-1.5 min-h-[3.5rem]"
            placeholder="Contoh: salah input item, pelanggan batal"
            required
          />
        </label>
        <label className="block">
          <span className="label-xs">PIN Supervisor (6 digit)</span>
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            className="field field-mono mt-1.5 tracking-[0.3em]"
            placeholder="••••••"
            required
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("NONE")} className="btn btn-ghost">
            Batal
          </button>
          <button type="submit" disabled={busy} className="btn btn-danger ml-auto">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Konfirmasi void
          </button>
        </div>
        {feedback ? (
          <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>
            {feedback.text}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form onSubmit={submitRefund} className="space-y-3">
      <div className="rounded-md border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-[0.8125rem] text-ink-700">
        Pilih kuantitas yang dikembalikan. Centang restock bila barang kembali layak jual dan boleh masuk stok.
      </div>

      <ul className="divide-y divide-ink-100">
        {refundable.length === 0 ? (
          <li className="py-2 text-[0.8125rem] text-ink-500">Semua item sudah diretur.</li>
        ) : (
          refundable.map((item) => {
            const remaining = item.qty - item.refundedQty;
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-medium">{item.productNameSnapshot}</p>
                  <p className="num text-[0.6875rem] text-ink-500">
                    {item.skuSnapshot} · sisa {remaining} dari {item.qty} · {formatIdr(item.appliedUnitPrice)}
                  </p>
                </div>
                <input
                  value={qty[item.id] ?? ""}
                  onChange={(event) => {
                    const value = Math.min(remaining, toNumber(event.target.value.replace(/[^\d]/g, "")));
                    setQty((current) => ({ ...current, [item.id]: value }));
                  }}
                  inputMode="numeric"
                  className="field field-mono w-16 shrink-0 text-center"
                  placeholder="0"
                  aria-label={`Kuantitas retur ${item.productNameSnapshot}`}
                />
              </li>
            );
          })
        )}
      </ul>

      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
        Kembalikan barang ke stok
      </label>

      <label className="block">
        <span className="label-xs">Alasan retur</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="field mt-1.5"
          placeholder="Contoh: kemasan rusak, pelanggan menukar barang"
          required
        />
      </label>

      <label className="block">
        <span className="label-xs">PIN Supervisor (6 digit)</span>
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          className="field field-mono mt-1.5 tracking-[0.3em]"
          placeholder="••••••"
          required
        />
      </label>

      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("NONE")} className="btn btn-ghost">
          Batal
        </button>
        <button type="submit" disabled={busy} className="btn btn-accent ml-auto">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Proses retur
        </button>
      </div>
      {feedback ? (
        <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>
          {feedback.text}
        </p>
      ) : null}
    </form>
  );
}
