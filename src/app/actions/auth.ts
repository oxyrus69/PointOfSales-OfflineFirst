"use server";

import { redirect } from "next/navigation";
import { loginWithPassword, logout } from "@/server/services/auth";
import { fail } from "@/server/services/errors";

export type LoginState = { ok: true; home: string } | { ok: false; error: string };

export async function loginAction(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  try {
    const result = await loginWithPassword({ email, password });
    return { ok: true, home: next && next.startsWith("/") && !next.startsWith("//") ? next : result.home };
  } catch (error) {
    return { ok: false, error: fail(error).error };
  }
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
