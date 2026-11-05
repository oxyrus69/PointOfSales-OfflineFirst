"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
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
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { CommandPalette, type PaletteItem } from "@/components/command-palette";

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
  activity: Activity,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
export type NavGroup = { title: string; items: NavItem[] };

/**
 * Zone A+B of the 5-zone enterprise shell: collapsible rail with grouped
 * navigation, live counters, system-health footer, and a top utility bar with
 * breadcrumbs + global command palette.
 */
export function AppShell({
  groups,
  user,
  storeName,
  telemetry,
  paletteItems,
  children,
}: {
  groups: NavGroup[];
  user: { fullName: string; role: string };
  storeName: string;
  telemetry: { online: boolean; pendingSync: number; dbLabel: string; openShift: string | null };
  paletteItems: PaletteItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const flat = groups.flatMap((group) => group.items);
  const current = flat.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const groupOfCurrent = groups.find((group) => group.items.some((item) => item === current));

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const roleLabel = user.role.replace(/_/g, " ");

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* ---------------------------------------------------------- Zone A */}
      <aside
        className={`till-shell fixed inset-y-0 left-0 z-40 flex flex-col transition-[width,transform] duration-200 ease-[var(--ease-settle)] lg:translate-x-0 ${
          collapsed ? "w-[4rem]" : "w-[15.5rem]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex items-center gap-2.5 px-3 pb-3 pt-4 ${collapsed ? "justify-center" : ""}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-paper text-[0.8125rem] font-bold text-ink-950">
            K
          </span>
          {collapsed ? null : (
            <div className="min-w-0">
              <p className="truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-paper">{storeName}</p>
              <p className="truncate text-[0.625rem] uppercase tracking-[0.1em] text-ink-400">{roleLabel}</p>
            </div>
          )}
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((group) => (
            <div key={group.title} className="mb-3">
              {collapsed ? (
                <div className="mx-auto mb-1.5 h-px w-6 bg-ink-800" />
              ) : (
                <p className="mb-1 px-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-ink-600">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = current?.href === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-2.5 rounded-sm text-[0.8125rem] transition-colors ${
                          collapsed ? "justify-center px-0 py-2" : "px-2.5 py-[0.4375rem]"
                        } ${active ? "bg-ink-800 font-medium text-paper" : "text-ink-300 hover:bg-ink-850 hover:text-paper"}`}
                      >
                        <Icon size={15} strokeWidth={1.9} className="shrink-0" />
                        {collapsed ? null : <span className="truncate">{item.label}</span>}
                        {item.badge ? (
                          <span
                            className={`num rounded-xs bg-flame-600 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white ${
                              collapsed ? "absolute ml-6 -mt-4" : "ml-auto"
                            }`}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* System health footer */}
        <div className="border-t border-ink-800 px-2.5 py-2.5">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              {telemetry.online ? (
                <Wifi size={13} className="text-grove-600" aria-label="Online" />
              ) : (
                <WifiOff size={13} className="text-caution-700" aria-label="Offline" />
              )}
              <span className="num text-[0.5625rem] text-ink-400">{telemetry.pendingSync}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[0.6875rem]">
                <span className="flex items-center gap-1.5 text-ink-400">
                  <span className={`h-1.5 w-1.5 rounded-pill ${telemetry.online ? "bg-grove-600" : "bg-caution-700"}`} />
                  {telemetry.online ? "Online" : "Offline"}
                </span>
                <span className="num text-ink-500">{telemetry.dbLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[0.6875rem]">
                <span className="text-ink-400">Antrean sync</span>
                <span className={`num ${telemetry.pendingSync ? "text-flame-500" : "text-ink-500"}`}>{telemetry.pendingSync}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[0.6875rem]">
                <span className="text-ink-400">Shift</span>
                <span className="num text-ink-300">{telemetry.openShift ?? "—"}</span>
              </div>
              <div className="mt-2 border-t border-ink-800 pt-2">
                <p className="truncate text-[0.8125rem] font-medium text-ink-100">{user.fullName}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="tag tag-neutral bg-ink-800 text-ink-300">{roleLabel}</span>
                  <button
                    type="button"
                    onClick={signOut}
                    disabled={signingOut}
                    className="flex items-center gap-1 text-[0.6875rem] text-ink-400 transition-colors hover:text-paper disabled:opacity-50"
                  >
                    <LogOut size={11} />
                    {signingOut ? "Keluar…" : "Keluar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
        />
      ) : null}

      <div className={`transition-[padding] duration-200 ease-[var(--ease-settle)] ${collapsed ? "lg:pl-[4rem]" : "lg:pl-[15.5rem]"}`}>
        {/* -------------------------------------------------------- Zone B */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-ink-200 bg-paper/95 px-3 backdrop-blur-[2px] sm:px-5">
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label={mobileOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={17} /> : <Menu size={17} />}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-500 hover:bg-ink-100 lg:flex"
            aria-label={collapsed ? "Lebarkan navigasi" : "Ringkas navigasi"}
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>

          <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 sm:block">
            <ol className="flex min-w-0 items-center gap-1.5 text-[0.75rem]">
              <li className="hidden shrink-0 text-ink-500 lg:block">{storeName}</li>
              <li className="hidden shrink-0 text-ink-300 lg:block">/</li>
              {groupOfCurrent ? (
                <>
                  <li className="hidden shrink-0 text-ink-500 md:block">{groupOfCurrent.title}</li>
                  <li className="hidden shrink-0 text-ink-300 md:block">/</li>
                </>
              ) : null}
              <li className="min-w-0 truncate font-medium text-ink-900">{current?.label ?? "Dasbor"}</li>
            </ol>
          </nav>

          <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium sm:hidden">{current?.label ?? "Dasbor"}</p>

          <div className="hidden min-w-0 flex-1 justify-center md:flex">
            <CommandPalette items={paletteItems} />
          </div>

          <div className="flex min-w-0 items-center gap-1.5">
            <span className="tag tag-neutral hidden items-center gap-1.5 sm:inline-flex">
              <span className={`h-1.5 w-1.5 rounded-pill ${telemetry.online ? "bg-grove-600" : "bg-caution-700"}`} />
              {telemetry.online ? "online" : "offline"}
            </span>
            {telemetry.pendingSync ? (
              <Link href="/pos/sync" className="tag tag-accent">
                <span className="num">{telemetry.pendingSync}</span> antrean
              </Link>
            ) : null}
            <div className="w-8 min-w-0 md:hidden">
              <CommandPalette items={paletteItems} compact />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[96rem] px-3 pb-14 pt-4 sm:px-5">{children}</main>
      </div>
    </div>
  );
}
