/**
 * Tiny adapter so every script talks to PGlite or a PostgreSQL server through
 * the same `query(text, params)` shape. Resolved from DATABASE_URL, exactly the
 * rule src/server/env.ts applies inside the app.
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

export function readDatabaseConfig() {
  const rawUrl = (process.env.DATABASE_URL ?? "").trim();
  const isServerPostgres = /^postgres(ql)?:\/\//i.test(rawUrl);
  const pglitePath = (() => {
    const url = rawUrl || "pglite://./.data/pglite";
    if (isServerPostgres) return "";
    const stripped = url.replace(/^pglite:\/\//i, "").replace(/^file:/i, "");
    return stripped || "./.data/pglite";
  })();
  return { rawUrl, isServerPostgres, pglitePath };
}

export async function connectDatabase() {
  const config = readDatabaseConfig();

  if (config.isServerPostgres) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(config.rawUrl, { max: 4, prepare: false, onnotice: () => {} });
    return {
      label: "PostgreSQL Server",
      query: async (text, params = []) => {
        const rows = await sql.unsafe(text, params);
        return { rows: Array.from(rows), rowCount: rows.count ?? rows.length };
      },
      exec: async (text) => {
        await sql.unsafe(text);
      },
      close: () => sql.end({ timeout: 5 }),
    };
  }

  await mkdir(path.dirname(path.resolve(repoRoot, config.pglitePath)), { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(config.pglitePath);
  await db.waitReady;

  return {
    label: `PGlite (${config.pglitePath})`,
    query: async (text, params = []) => {
      const result = await db.query(text, params);
      return { rows: result.rows, rowCount: result.rows.length };
    },
    exec: async (text) => {
      await db.exec(text);
    },
    close: () => db.close(),
  };
}

// Compiled once on import: keeps POS SQL untyped and table names static.
export function readSqlFile(fileName) {
  return fileURLToPath(new URL(`../sql/${fileName}`, import.meta.url));
}
