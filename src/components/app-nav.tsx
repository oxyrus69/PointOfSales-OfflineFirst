"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Users,
  Wallet,
  X,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; hint?: string };

const ICONS = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  shifts: Wallet,
  transactions: Receipt,
  products: PackageSearch,
  inventory: Boxes,
  customers: Users,
  promos: Tag,
  dss: BarChart3,
  audit: ShieldCheck,
  settings: Settings,
  sync: ClipboardList,
  payments: CreditCard,
};

export function AppNav({
  items,
  user,
  storeName,
  offlineQueue,
}: {
  items: NavItem[];
  user: { fullName: string; role: string };
  storeName: string;
  offlineQueue?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const roleLabel = user.role.replace(/_/g, " ");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-sm border border-ink-200 bg-paper text-ink-700 lg:hidden"
        aria-label={open ? "Tutup menu" : "Buka menu"}
        aria-expanded={open}
      >
        {open ? <X size={17} /> : <Menu size={17} />}
      </button>

      <aside
        className={`till-shell fixed inset-y-0 left-0 z-30 flex w-[15.5rem] flex-col transition-transform duration-200 ease-[var(--ease-settle)] lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-paper text-[0.8125rem] font-bold text-ink-950">
            K
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-paper">{storeName}</p>
            <p className="truncate text-[0.6875rem] uppercase tracking-[0.1em] text-ink-400">{roleLabel}</p>
          </div>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-sm px-2.5 py-[0.4375rem] text-[0.8125rem] transition-colors ${
                      active
                        ? "bg-ink-800 font-medium text-paper"
                        : "text-ink-300 hover:bg-ink-850 hover:text-paper"
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.9} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.icon === "sync" && offlineQueue ? (
                      <span className="num ml-auto rounded-xs bg-flame-600 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
                        {offlineQueue}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-ink-800 px-3 py-3">
          <p className="truncate text-[0.8125rem] font-medium text-ink-100">{user.fullName}</p>
          <button
            type="button"
            onClick={signOut}
            disabled={pending}
            className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-ink-400 transition-colors hover:text-paper disabled:opacity-50"
          >
            <LogOut size={13} />
            {pending ? "Keluar…" : "Keluar dari terminal"}
          </button>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-ink-950/40 lg:hidden"
        />
      ) : null}
    </>
  );
}
