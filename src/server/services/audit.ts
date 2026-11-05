import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { auditLogs, profiles } from "@/server/db/schema";

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  severity: string;
  metadata: unknown;
  createdAt: Date;
  actorName: string | null;
  actorRole: string | null;
  authorizedByName: string | null;
};

export async function listAuditLogs(options?: {
  action?: string;
  severity?: string;
  actorId?: string;
  days?: number;
  limit?: number;
}): Promise<AuditRow[]> {
  const db = await getDb();
  const actor = profiles;

  const conditions: SQL[] = [];
  if (options?.action) conditions.push(eq(auditLogs.action, options.action));
  if (options?.severity) conditions.push(eq(auditLogs.severity, options.severity));
  if (options?.actorId) conditions.push(eq(auditLogs.actorId, options.actorId));
  if (options?.days) conditions.push(gte(auditLogs.createdAt, new Date(Date.now() - options.days * 86_400_000)));

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      severity: auditLogs.severity,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: actor.fullName,
      actorRole: actor.role,
      authorizedById: auditLogs.authorizedById,
    })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(options?.limit ?? 200);

  const supervisorIds = Array.from(new Set(rows.map((row) => row.authorizedById).filter(Boolean) as string[]));
  const supervisors = supervisorIds.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(sql`${profiles.id} = any(${sql.raw(`ARRAY['${supervisorIds.join("','")}']::uuid[]`)})`)
    : [];
  const supervisorMap = new Map(supervisors.map((row) => [row.id, row.fullName]));

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    severity: row.severity,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actorName: row.actorName,
    actorRole: row.actorRole,
    authorizedByName: row.authorizedById ? supervisorMap.get(row.authorizedById) ?? null : null,
  }));
}

export async function auditActionOptions(): Promise<{ action: string; count: number }[]> {
  const db = await getDb();
  const rows = await db
    .select({ action: auditLogs.action, count: sql<string>`count(*)` })
    .from(auditLogs)
    .groupBy(auditLogs.action)
    .orderBy(desc(sql`count(*)`));
  return rows.map((row) => ({ action: row.action, count: Number(row.count ?? 0) }));
}

export async function auditStats(days = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const [row] = await db
    .select({
      total: sql<string>`count(*)`,
      critical: sql<string>`count(*) filter (where ${auditLogs.severity} = 'CRITICAL')`,
      warning: sql<string>`count(*) filter (where ${auditLogs.severity} = 'WARNING')`,
      supervisorActions: sql<string>`count(*) filter (where ${auditLogs.authorizedById} is not null)`,
    })
    .from(auditLogs)
    .where(gte(auditLogs.createdAt, since));
  return {
    total: Number(row?.total ?? 0),
    critical: Number(row?.critical ?? 0),
    warning: Number(row?.warning ?? 0),
    supervisorActions: Number(row?.supervisorActions ?? 0),
  };
}

export async function listStaff() {
  const db = await getDb();
  return db
    .select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
      isActive: profiles.isActive,
      hasPin: sql<boolean>`${profiles.supervisorPinHash} is not null`,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(profiles.fullName);
}

export async function setStaffPin(input: { userId: string; pin: string; actorId: string }) {
  const db = await getDb();
  await db.update(profiles).set({ supervisorPinHash: input.pin }).where(eq(profiles.id, input.userId));
}
