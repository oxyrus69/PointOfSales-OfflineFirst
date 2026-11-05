"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { openShiftAction } from "@/app/actions/shifts";
import { formatIdr, toNumber } from "@/lib/format";

export function OpenShiftForm({ hasOpenShift, shiftNumber }: { hasOpenShift: boolean; shiftNumber: string | null }) {
  const [openingCash, setOpeningCash] = useState("500000");
  const [terminalId, setTerminalId] = useState("KASIR-01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (hasOpenShift) {
    return (
      <div className="rounded-md border border-signal-100 bg-signal-100 px-3.5 py-3 text-[0.8125rem] text-signal-700">
        Shift <span className="num font-semibold">{shiftNumber}</span> sedang berjalan. Tutup shift ini dulu sebelum
        membuka shift baru.
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await openShiftAction({ openingCash: toNumber(openingCash), terminalId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(result.data.shiftNumber);
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
      <label className="block">
        <span className="label-xs">Modal awal laci (Rp)</span>
        <input
          value={openingCash}
          onChange={(event) => setOpeningCash(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          className="field field-mono mt-1.5"
          required
        />
        <span className="mt-1 block text-[0.6875rem] text-ink-500">{formatIdr(toNumber(openingCash))}</span>
      </label>
      <label className="block">
        <span className="label-xs">Terminal</span>
        <input
          value={terminalId}
          onChange={(event) => setTerminalId(event.target.value.toUpperCase())}
          className="field field-mono mt-1.5"
          maxLength={12}
          required
        />
      </label>
      <button type="submit" disabled={busy} className="btn btn-accent">
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        Buka shift
      </button>
      {error ? <p className="text-[0.8125rem] text-alert-700 sm:col-span-3">{error}</p> : null}
      {done ? <p className="text-[0.8125rem] text-grove-700 sm:col-span-3">Shift {done} dibuka.</p> : null}
    </form>
  );
}
