import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "";
const isServerPostgres = /^postgres(ql)?:\/\//i.test(databaseUrl);

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(isServerPostgres
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite", dbCredentials: { url: ".data/pglite" } }),
});
