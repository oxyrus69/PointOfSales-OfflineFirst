"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { closeShiftAction, recordCashMovementAction } from "@/app/actions/shifts";
import { formatIdr, toNumber } from "@/lib/format";

const MOVEMENT_LABEL: Record<string, string> = {
  CASH_IN_MISC: "Kas masuk",
  CASH_OUT_EXPENSE: "Kas keluar",
  CASH_DROP_SAFE: "Setor ke brankas",
};

export function CashMovementForm({ shiftId, pinThreshold }: { shiftId: string; pinThreshold: number }) {
  const [movementType, setMovementType] = useState<"CASH_IN_MISC" | "CASH_OUT_EXPENSE" | "CASH_DROP_SAFE">("CASH_OUT_EXPENSE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const needsPin = movementType !== "CASH_IN_MISC" && toNumber(amount) > pinThreshold;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await recordCashMovementAction({
      shiftId,
      movementType,
      amount: toNumber(amount),
      reason,
      supervisorPin: needsPin ? pin : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({ tone: "ok", text: `${MOVEMENT_LABEL[movementType]} ${formatIdr(amount)} tercatat.` });
    setAmount("");
    setReason("");
    setPin("");
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="label-xs">Jenis pergerakan</span>
        <select
          value={movementType}
          onChange={(event) => setMovementType(event.target.value as typeof movementType)}
          className="field mt-1.5"
        >
          <option value="CASH_OUT_EXPENSE">Kas keluar (belanja operasional)</option>
          <option value="CASH_IN_MISC">Kas masuk (tambahan modal)</option>
          <option value="CASH_DROP_SAFE">Setor ke brankas</option>
        </select>
      </label>

      <label className="block">
        <span className="label-xs">Nominal (Rp)</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          className="field field-mono mt-1.5"
          placeholder="0"
          required
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="label-xs">Alasan</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="field mt-1.5"
          placeholder="Contoh: beli es batu dan plastik kemasan"
          required
        />
      </label>

      {needsPin ? (
        <label className="block sm:col-span-2">
          <span className="label-xs">PIN Supervisor (di atas {formatIdr(pinThreshold)})</span>
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            className="field field-mono mt-1.5"
            placeholder="6 digit"
          />
        </label>
      ) : null}

      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Catat pergerakan kas
        </button>
      </div>

      {feedback ? (
        <p className={`text-[0.8125rem] sm:col-span-2 ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>
          {feedback.text}
        </p>
      ) : null}
    </form>
  );
}

export function CloseShiftForm({ shiftId, tolerance }: { shiftId: string; tolerance: number }) {
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; expectedCash: number; actualCash: number; variance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await closeShiftAction({
      shiftId,
      actualCashCounted: toNumber(actualCash),
      closingNotes: notes,
      supervisorPin: pin || undefined,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setResult(response.data);
  }

  if (result) {
    const variantTone = result.variance === 0 ? "border-grove-100 bg-grove-100 text-grove-700" : "border-caution-100 bg-caution-100 text-caution-700";
    return (
      <div className={`rounded-md border px-3.5 py-3 text-[0.8125rem] ${variantTone}`}>
        <p className="font-semibold">Shift ditutup: {result.status.replace(/_/g, " ")}</p>
        <p className="num mt-1.5">
          Uang fisik dihitung {formatIdr(result.actualCash)} · sistem {formatIdr(result.expectedCash)} · selisih{" "}
          {formatIdr(result.variance)}
        </p>
        <a href={`/reports/shift/${shiftId}`} className="mt-2 inline-block underline">
          Buka laporan Z Report
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="rounded-md border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-[0.8125rem] text-ink-700">
        Hitung uang kertas dan logam di laci sekarang. Angka yang seharusnya ada menurut sistem tidak ditampilkan
        sebelum Anda mengirim hitungan, supaya laci benar-benar dihitung.
      </div>
      <label className="block">
        <span className="label-xs">Total uang fisik dihitung (Rp)</span>
        <input
          value={actualCash}
          onChange={(event) => setActualCash(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          className="field field-mono mt-1.5 text-[1.125rem]"
          placeholder="0"
          required
        />
      </label>
      <label className="block">
        <span className="label-xs">Catatan penutupan (opsional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="field mt-1.5 min-h-[4.5rem] resize-y"
          placeholder="Contoh: ada pembeli antre saat pergantian shift"
        />
      </label>
      <label className="block">
        <span className="label-xs">PIN Supervisor (bila selisih melebihi {formatIdr(Math.max(tolerance, 50000))})</span>
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          className="field field-mono mt-1.5"
          placeholder="Kosongkan bila yakin cocok"
        />
      </label>
      <button type="submit" disabled={busy} className="btn btn-accent">
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        Tutup shift & hitung selisih
      </button>
      {error ? <p className="text-[0.8125rem] text-alert-700">{error}</p> : null}
    </form>
  );
}
