import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { getStoreSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Masuk" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "";
  let storeName = "Katalis Mart";
  try {
    const settings = await getStoreSettings();
    storeName = settings.storeName;
  } catch {
    // Database not migrated yet — the login screen must still render.
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ink-50 px-4 py-10">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-ink-950 text-[0.875rem] font-bold text-paper">
          K
        </span>
        <div>
          <p className="text-[0.9375rem] font-semibold leading-tight">{storeName}</p>
          <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-ink-500">Katalis POS · Offline-first</p>
        </div>
      </div>
      <LoginForm next={next} />
    </main>
  );
}
