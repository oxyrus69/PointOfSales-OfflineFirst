import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { verifyPassword } from "@/server/crypto";
import { env } from "@/server/env";
import { createSessionToken, ROLE_HOME } from "@/server/session";
import { AuthError, writeAudit } from "@/server/rbac";

/**
 * Password login. Deliberately generic failure message so the endpoint cannot
 * be used to enumerate valid emails.
 */
export async function loginWithPassword(input: {
  email: string;
  password: string;
}): Promise<{ role: string; home: string; fullName: string }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) throw new AuthError("Email dan kata sandi wajib diisi.", 400);

  const db = await getDb();
  const [user] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    await writeAudit({
      actorId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entityType: "auth",
      entityId: email,
      severity: "WARNING",
      metadata: { email },
    });
    throw new AuthError("Email atau kata sandi salah.", 401);
  }

  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  });

  const cookieStore = await cookies();
  cookieStore.set(env.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  await writeAudit({
    actorId: user.id,
    action: "LOGIN_SUCCESS",
    entityType: "auth",
    entityId: user.id,
    metadata: { role: user.role },
  });

  return { role: user.role, home: ROLE_HOME[user.role], fullName: user.fullName };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(env.sessionCookieName);
}
