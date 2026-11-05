import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { auditLogs, profiles, type UserRole } from "@/server/db/schema";
import { env } from "@/server/env";
import { ROLE_HOME, readSessionToken, type SessionPayload } from "@/server/session";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  hasSupervisorPin: boolean;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/** Reads the signed cookie and re-validates the row (active + role unchanged). */
export async function getCurrentSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(env.sessionCookieName)?.value);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
      isActive: profiles.isActive,
      supervisorPinHash: profiles.supervisorPinHash,
    })
    .from(profiles)
    .where(eq(profiles.id, session.userId))
    .limit(1);
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    hasSupervisorPin: Boolean(row.supervisorPinHash),
  };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Sesi tidak valid. Silakan login ulang.", 401);
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AuthError(
      `Peran ${user.role} tidak diizinkan melakukan aksi ini. Dibutuhkan: ${roles.join(", ")}.`,
      403,
    );
  }
  return user;
}

/** Page-level guard: redirects instead of throwing so the router handles it. */
export async function requirePageUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePageRole(...roles: UserRole[]): Promise<AuthUser> {
  const user = await requirePageUser();
  if (!roles.includes(user.role)) redirect(`${ROLE_HOME[user.role]}?denied=forbidden`);
  return user;
}

export async function writeAudit(entry: {
  actorId?: string | null;
  authorizedById?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    authorizedById: entry.authorizedById ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    severity: entry.severity ?? "INFO",
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress ?? null,
  });
}

/** Server actions cannot read headers reliably for IP; kept explicit for routes. */
export function describeError(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof Error) return error.message;
  return "Terjadi kesalahan tak terduga.";
}

export async function findActiveProfile(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, role: profiles.role, isActive: profiles.isActive })
    .from(profiles)
    .where(and(eq(profiles.id, id), eq(profiles.isActive, true)))
    .limit(1);
  return row ?? null;
}
