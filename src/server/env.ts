/**
 * Environment configuration.
 * Edge-safe: no node:fs / node:crypto imports here, middleware imports this.
 */

const DEMO_SESSION_SECRET = "katalis-pos-demo-session-secret-do-not-use-in-production";
const DEMO_RECEIPT_KEY = "katalis-pos-demo-receipt-signing-key-do-not-use-in-production";

function normalizeDatabaseUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "pglite://./.data/pglite";
  return value;
}

export type DatabaseMode = "pglite" | "postgres";

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
const isServerPostgres = /^postgres(ql)?:\/\//i.test(databaseUrl);
const isProduction = process.env.NODE_ENV === "production";

function readSecret(name: "SESSION_SECRET" | "RECEIPT_SIGNING_KEY", fallback: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length >= 16) return value;
  if (isServerPostgres && isProduction) {
    throw new Error(
      `${name} wajib diisi minimal 16 karakter saat NODE_ENV=production dengan PostgreSQL Server. Jalankan: npm run secrets:generate`,
    );
  }
  return fallback;
}

export const env = {
  databaseUrl,
  databaseMode: (isServerPostgres ? "postgres" : "pglite") as DatabaseMode,
  pglitePath: (() => {
    if (isServerPostgres) return "";
    const stripped = databaseUrl.replace(/^pglite:\/\//i, "").replace(/^file:/i, "");
    return stripped || "./.data/pglite";
  })(),
  sessionSecret: readSecret("SESSION_SECRET", DEMO_SESSION_SECRET),
  receiptSigningKey: readSecret("RECEIPT_SIGNING_KEY", DEMO_RECEIPT_KEY),
  isProduction,
  isDemoDatabase: !isServerPostgres,
  storeName: process.env.STORE_NAME ?? "Katalis Mart",
  sessionCookieName: "katalis_session",
  shiftCookieName: "katalis_shift",
} as const;

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
