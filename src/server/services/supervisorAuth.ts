import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { profiles, type UserRole } from "@/server/db/schema";
import { verifyPin } from "@/server/crypto";
import { AuthError, writeAudit } from "@/server/rbac";

export type SupervisorGrant = {
  supervisorId: string;
  supervisorName: string;
  role: UserRole;
};

const SUPERVISOR_ROLES: UserRole[] = ["SUPER_ADMIN", "STORE_MANAGER"];

/**
 * Verifies a 6-digit supervisor PIN against every active SUPER_ADMIN /
 * STORE_MANAGER that has a PIN configured. A cashier can therefore call a
 * manager to the till without logging the manager in.
 */
export async function verifySupervisorPin(input: {
  pin: string | null | undefined;
  action: string;
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<SupervisorGrant> {
  const rawPin = (input.pin ?? "").trim();
  if (!/^\d{6}$/.test(rawPin)) {
    await writeAudit({
      actorId: input.actorId ?? null,
      action: `${input.action}_PIN_REJECTED`,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      severity: "WARNING",
      metadata: { reason: "PIN kosong atau bukan 6 digit", ...(input.metadata ?? {}) },
    });
    throw new AuthError("PIN Supervisor wajib 6 digit.", 400);
  }

  const db = await getDb();
  const candidates = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      pinHash: profiles.supervisorPinHash,
    })
    .from(profiles)
    .where(and(inArray(profiles.role, SUPERVISOR_ROLES), eq(profiles.isActive, true)));

  const match = candidates.find((candidate) => candidate.pinHash && verifyPin(rawPin, candidate.pinHash));

  if (!match) {
    await writeAudit({
      actorId: input.actorId ?? null,
      action: `${input.action}_PIN_REJECTED`,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      severity: "CRITICAL",
      metadata: { reason: "PIN Supervisor tidak cocok", ...(input.metadata ?? {}) },
    });
    throw new AuthError("PIN Supervisor salah. Aksi dibatalkan dan dicatat di jejak audit.", 403);
  }

  return { supervisorId: match.id, supervisorName: match.fullName, role: match.role };
}

/** Explicit guard for endpoints that must never accept a cashier's own PIN. */
export async function requireSupervisorRole(pin: string, action: string): Promise<SupervisorGrant> {
  const grant = await verifySupervisorPin({
    pin,
    action,
    entityType: "authorization",
    entityId: null,
  });
  if (!SUPERVISOR_ROLES.includes(grant.role)) {
    throw new AuthError("Peran ini tidak boleh mengotorisasi aksi sensitif.", 403);
  }
  return grant;
}
