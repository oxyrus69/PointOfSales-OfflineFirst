/** IDR formatting and numeric coercion shared by server and client. */

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toInt(value: unknown, fallback = 0): number {
  const parsed = toNumber(value, fallback);
  return Math.trunc(parsed);
}

const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const plainFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatIdr(value: unknown): string {
  return idrFormatter.format(Math.round(toNumber(value)));
}

export function formatNumber(value: unknown): string {
  return plainFormatter.format(toNumber(value));
}

export function formatCompactIdr(value: unknown): string {
  const amount = Math.round(toNumber(value));
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)} M`;
  if (abs >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)} jt`;
  if (abs >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)} rb`;
  return `Rp ${amount}`;
}

export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPct(value: unknown, digits = 1): string {
  return `${toNumber(value).toFixed(digits)}%`;
}

/** Numeric money column → string for PostgreSQL numeric(14,2) writes. */
export function moneyString(value: unknown): string {
  return Math.round(toNumber(value)).toFixed(2);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
