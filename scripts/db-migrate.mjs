#!/usr/bin/env node
/**
 * db-migrate.mjs — applies scripts/sql/schema.sql to whichever database the
 * DATABASE_URL selects: PGlite (default, demo) or a PostgreSQL server.
 *
 * Idempotent: every statement uses IF NOT EXISTS / duplicate_object guards.
 */
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { splitStatements } from "./lib/sql-split.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const rawUrl = (process.env.DATABASE_URL ?? "").trim();
const isServerPostgres = /^postgres(ql)?:\/\//i.test(rawUrl);
const pglitePath = (() => {
  const url = rawUrl || "pglite://./.data/pglite";
  if (isServerPostgres) return "";
  const stripped = url.replace(/^pglite:\/\//i, "").replace(/^file:/i, "");
  return stripped || "./.data/pglite";
})();

async function migratePglite(statements) {
  const { PGlite } = await import("@electric-sql/pglite");
  await mkdir(path.dirname(path.resolve(repoRoot, pglitePath)), { recursive: true });
  const db = new PGlite(pglitePath);
  await db.waitReady;
  for (const statement of statements) {
    await db.exec(statement);
  }
  await db.close();
}

async function migratePostgres(statements) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const sqlText = await readFile(path.join(here, "sql", "schema.sql"), "utf8");
  const statements = splitStatements(sqlText);
  const target = isServerPostgres ? `PostgreSQL Server (${rawUrl.replace(/:\/\/.*@/, "://***@")})` : `PGlite (${pglitePath})`;

  console.log(`[db:migrate] target  : ${target}`);
  console.log(`[db:migrate] statements: ${statements.length}`);

  if (isServerPostgres) await migratePostgres(statements);
  else await migratePglite(statements);

  console.log("[db:migrate] OK — schema is up to date.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[db:migrate] FAILED:", error);
  process.exit(1);
});
