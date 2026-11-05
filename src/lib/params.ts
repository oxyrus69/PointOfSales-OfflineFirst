/** URL and form parameter sanitizers shared by pages that read searchParams. */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function sanitizeText(value: unknown, maxLength = 80): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, maxLength);
  // Strip control characters and anything that could break a query string.
  return trimmed.replace(/[\u0000-\u001F\u007F<>]/g, "");
}

export function sanitizeUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
}

export function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string") return undefined;
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export function sanitizeInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
