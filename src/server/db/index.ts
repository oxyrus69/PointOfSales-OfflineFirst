import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * Both drivers return a PgDatabase-compatible builder. The AppDb alias keeps
 * every call site fully typed against `schema`; the only controlled cast lives
 * in this file (postgres-js result HKT differs from PGlite's).
 */
export type AppDb = PgliteDatabase<typeof schema>;

type DbGlobal = typeof globalThis & {
  __katalisDbPromise?: Promise<AppDb>;
  __katalisPglite?: PGlite;
  __katalisSql?: ReturnType<typeof postgres>;
};

const globalRef = globalThis as DbGlobal;

async function createPglite(): Promise<AppDb> {
  // PGlite's node FS driver does not create parent directories itself.
  const dataDir = path.resolve(process.cwd(), env.pglitePath);
  await mkdir(path.dirname(dataDir), { recursive: true });

  // Next dev re-evaluates server modules on hot reload; two PGlite handles on
  // the same directory deadlock on the file lock. Always reuse the instance.
  const existing = globalRef.__katalisPglite;
  if (existing) {
    return drizzlePglite(existing, { schema }) as unknown as AppDb;
  }

  // Absolute POSIX-style path: PGlite's node FS adapter mishandles URL objects
  // when bundled (ERR_INVALID_ARG_TYPE from path.dirname).
  const instance = new PGlite(dataDir.split(path.sep).join("/"));
  await instance.waitReady;
  globalRef.__katalisPglite = instance;
  return drizzlePglite(instance, { schema }) as unknown as AppDb;
}

function createPostgres(): AppDb {
  const client = postgres(env.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  globalRef.__katalisSql = client;
  return drizzlePostgres(client, { schema }) as unknown as AppDb;
}

export async function getDb(): Promise<AppDb> {
  if (!globalRef.__katalisDbPromise) {
    globalRef.__katalisDbPromise = env.databaseMode === "postgres"
      ? Promise.resolve(createPostgres())
      : createPglite();
  }
  return globalRef.__katalisDbPromise;
}

/** Test/script helper: drop the singleton so a fresh process handle is used. */
export async function closeDb(): Promise<void> {
  const instance = globalRef.__katalisPglite;
  const client = globalRef.__katalisSql;
  globalRef.__katalisDbPromise = undefined;
  globalRef.__katalisPglite = undefined;
  globalRef.__katalisSql = undefined;
  if (instance) await instance.close();
  if (client) await client.end({ timeout: 5 });
}

export { schema };
