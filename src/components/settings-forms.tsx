"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { saveSettingsAction, setSupervisorPinAction } from "@/app/actions/admin";
import { formatIdr, toNumber } from "@/lib/format";
import type { StoreSettings } from "@/server/services/settings";

export function SettingsForm({ settings }: { settings: StoreSettings }) {
  const [form, setForm] = useState({
    storeName: settings.storeName,
    storeAddress: settings.storeAddress,
    storePhone: settings.storePhone,
    taxRatePct: String(settings.taxRatePct),
    priceIncludesTax: settings.priceIncludesTax,
    cashRoundingStep: String(settings.cashRoundingStep),
    cashierDiscountLimitPct: String(settings.cashierDiscountLimitPct),
    cashOutPinThreshold: String(settings.cashOutPinThreshold),
    supervisorVoidEnabled: settings.supervisorVoidEnabled,
    varianceToleranceIdr: String(settings.varianceToleranceIdr),
    leadTimeDays: String(settings.leadTimeDays),
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await saveSettingsAction({
      storeName: form.storeName,
      storeAddress: form.storeAddress,
      storePhone: form.storePhone,
      taxRatePct: toNumber(form.taxRatePct),
      priceIncludesTax: form.priceIncludesTax,
      cashRoundingStep: toNumber(form.cashRoundingStep),
      cashierDiscountLimitPct: toNumber(form.cashierDiscountLimitPct),
      cashOutPinThreshold: toNumber(form.cashOutPinThreshold),
      supervisorVoidEnabled: form.supervisorVoidEnabled,
      varianceToleranceIdr: toNumber(form.varianceToleranceIdr),
      leadTimeDays: toNumber(form.leadTimeDays),
    });
    setBusy(false);
    setFeedback(result.ok ? { tone: "ok", text: "Pengaturan disimpan dan berlaku di terminal berikutnya." } : { tone: "error", text: result.error });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-xs">Nama toko</span>
          <input value={form.storeName} onChange={(event) => update("storeName", event.target.value)} className="field mt-1.5" required />
        </label>
        <label className="block">
          <span className="label-xs">Telepon</span>
          <input value={form.storePhone} onChange={(event) => update("storePhone", event.target.value)} className="field field-mono mt-1.5" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-xs">Alamat</span>
          <input value={form.storeAddress} onChange={(event) => update("storeAddress", event.target.value)} className="field mt-1.5" />
        </label>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <p className="text-[0.875rem] font-medium">Pajak & pembulatan</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label-xs">Tarif PPN (%)</span>
            <input
              value={form.taxRatePct}
              onChange={(event) => update("taxRatePct", event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="field field-mono mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label-xs">Pembulatan tunai (Rp)</span>
            <input
              value={form.cashRoundingStep}
              onChange={(event) => update("cashRoundingStep", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="field field-mono mt-1.5"
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-[0.8125rem]">
            <input type="checkbox" checked={form.priceIncludesTax} onChange={(event) => update("priceIncludesTax", event.target.checked)} />
            Harga sudah termasuk PPN
          </label>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <p className="text-[0.875rem] font-medium">Batas kasir & laci</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label-xs">Diskon manual kasir (%)</span>
            <input
              value={form.cashierDiscountLimitPct}
              onChange={(event) => update("cashierDiscountLimitPct", event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="field field-mono mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label-xs">PIN kas keluar di atas (Rp)</span>
            <input
              value={form.cashOutPinThreshold}
              onChange={(event) => update("cashOutPinThreshold", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="field field-mono mt-1.5"
            />
            <span className="mt-1 block text-[0.625rem] text-ink-500">{formatIdr(toNumber(form.cashOutPinThreshold))}</span>
          </label>
          <label className="block">
            <span className="label-xs">Toleransi selisih kas (Rp)</span>
            <input
              value={form.varianceToleranceIdr}
              onChange={(event) => update("varianceToleranceIdr", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="field field-mono mt-1.5"
            />
          </label>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <p className="text-[0.875rem] font-medium">Operasional</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label-xs">Lead time supplier (hari)</span>
            <input
              value={form.leadTimeDays}
              onChange={(event) => update("leadTimeDays", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="field field-mono mt-1.5"
            />
            <span className="mt-1 block text-[0.625rem] text-ink-500">Dipakai DSS untuk memprediksi kehabisan stok</span>
          </label>
          <label className="flex items-end gap-2 pb-2 text-[0.8125rem]">
            <input type="checkbox" checked={form.supervisorVoidEnabled} onChange={(event) => update("supervisorVoidEnabled", event.target.checked)} />
            Wajib PIN supervisor untuk void
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-ink-100 pt-3">
        <button type="submit" disabled={busy} className="btn btn-accent">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Simpan pengaturan
        </button>
        {feedback ? (
          <p className={`text-[0.8125rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>{feedback.text}</p>
        ) : null}
      </div>
    </form>
  );
}

export function PinForm({ userId, hasPin }: { userId: string; hasPin: boolean }) {
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await setSupervisorPinAction({ userId, pin, currentPin: currentPin || undefined });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({ tone: "ok", text: "PIN supervisor diperbarui." });
    setPin("");
    setCurrentPin("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      {hasPin ? (
        <label className="block">
          <span className="label-xs">PIN lama</span>
          <input
            value={currentPin}
            onChange={(event) => setCurrentPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            className="field field-mono mt-1 w-24 text-center tracking-[0.3em]"
            placeholder="••••••"
          />
        </label>
      ) : null}
      <label className="block">
        <span className="label-xs">{hasPin ? "PIN baru" : "Buat PIN"}</span>
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          className="field field-mono mt-1 w-24 text-center tracking-[0.3em]"
          placeholder="••••••"
          required
        />
      </label>
      <button type="submit" disabled={busy || pin.length !== 6} className="btn btn-ghost">
        {busy ? <Loader2 size={13} className="animate-spin" /> : null}
        Simpan PIN
      </button>
      {feedback ? (
        <p className={`text-[0.75rem] ${feedback.tone === "ok" ? "text-grove-700" : "text-alert-700"}`}>{feedback.text}</p>
      ) : null}
    </form>
  );
}
