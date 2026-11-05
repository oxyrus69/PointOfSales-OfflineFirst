import { env } from "@/server/env";
import { base64UrlDecode, base64UrlEncode, hmacSha256, verifyHmac } from "@/lib/hmac";
import type { UserRole } from "@/server/db/schema";

/**
 * Signed, stateless session cookie. Middleware (edge) reads it without touching
 * the database; service functions re-validate the user row on every mutation.
 */

export type SessionPayload = {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  iat: number;
  exp: number;
};

function encodePayload(payload: SessionPayload): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(encoded: string): SessionPayload | null {
  try {
    const json = new TextDecoder().decode(base64UrlDecode(encoded));
    const parsed = JSON.parse(json) as SessionPayload;
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.exp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function createSessionToken(payload: Omit<SessionPayload, "iat" | "exp">, ttlSeconds = 60 * 60 * 12): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = encodePayload(full);
  const signature = await hmacSha256(body, env.sessionSecret);
  return `${body}.${signature}`;
}

export async function readSessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const valid = await verifyHmac(body, signature, env.sessionSecret);
  if (!valid) return null;
  const payload = decodePayload(body);
  if (!payload) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export const ROLE_HOME: Record<UserRole, string> = {
  SUPER_ADMIN: "/admin",
  STORE_MANAGER: "/admin",
  CASHIER: "/pos",
  WAREHOUSE_STAFF: "/inventory",
};

/**
 * Longest-prefix route authorisation map. Anything not listed defaults to
 * "authenticated only"; the map is what makes /admin unreachable for a cashier.
 */
export const ROUTE_ROLES: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/admin/settings", roles: ["SUPER_ADMIN"] },
  { prefix: "/admin/audit", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
  { prefix: "/admin", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
  { prefix: "/dss", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
  { prefix: "/transactions", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/shifts", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/pos/sync", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/pos", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/products", roles: ["SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF"] },
  { prefix: "/inventory", roles: ["SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF"] },
  { prefix: "/customers", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/promos", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
  { prefix: "/api/pos", roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"] },
  { prefix: "/api/export/sales", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
  { prefix: "/api/export/inventory", roles: ["SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF"] },
  { prefix: "/api/export/shifts", roles: ["SUPER_ADMIN", "STORE_MANAGER"] },
];

export function rolesForPath(pathname: string): UserRole[] {
  let match: { prefix: string; roles: UserRole[] } | null = null;
  for (const entry of ROUTE_ROLES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      if (!match || entry.prefix.length > match.prefix.length) match = entry;
    }
  }
  return match ? match.roles : ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER", "WAREHOUSE_STAFF"];
}

export const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Print routes are opened from a receipt link and carry their own signature.
  if (pathname.startsWith("/receipt/") || pathname.startsWith("/reports/shift/")) return true;
  return false;
}
