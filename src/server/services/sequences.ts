import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { documentSequences } from "@/server/db/schema";

/**
 * Atomic document numbering. Uses INSERT ... ON CONFLICT DO UPDATE ... RETURNING
 * so two concurrent tills can never mint the same receipt number.
 */
export async function nextDocumentNumber(key: string, prefix: string, pad = 4): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(documentSequences)
    .values({ key, prefix, nextValue: 2 })
    .onConflictDoUpdate({
      target: documentSequences.key,
      set: { nextValue: sql`${documentSequences.nextValue} + 1`, updatedAt: new Date() },
    })
    .returning({ nextValue: documentSequences.nextValue, prefix: documentSequences.prefix });

  const used = (row?.nextValue ?? 2) - 1;
  const actualPrefix = row?.prefix ?? prefix;
  // Longest token first: "YYYYMMDD" also contains "YYYYMM".
  if (actualPrefix.includes("YYYYMMDD")) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    return `${actualPrefix.replace("YYYYMMDD", stamp)}-${String(used).padStart(pad, "0")}`;
  }
  if (actualPrefix.includes("YYYYMM")) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    return `${actualPrefix.replace("YYYYMM", stamp)}-${String(used).padStart(pad, "0")}`;
  }
  return `${actualPrefix}-${String(used).padStart(pad, "0")}`;
}

export async function currentSequenceValue(key: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ nextValue: documentSequences.nextValue })
    .from(documentSequences)
    .where(eq(documentSequences.key, key))
    .limit(1);
  return row ? Math.max(0, row.nextValue - 1) : 0;
}

/** Offline receipts keep a terminal-scoped number until the server maps them. */
export function offlineReceiptNumber(terminalId: string, createdAt: string, seq: number): string {
  const compact = createdAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const terminal = terminalId.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "KASIR01";
  return `OFF-${terminal}-${compact}-${String(seq).padStart(3, "0")}`;
}
