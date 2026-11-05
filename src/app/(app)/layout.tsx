import type { ReactNode } from "react";
import { and, eq, sql } from "drizzle-orm";
import { AppShell, type NavGroup } from "@/components/app-shell";
import type { PaletteItem } from "@/components/command-palette";
import { requirePageUser } from "@/server/rbac";
import { getStoreSettings } from "@/server/services/settings";
import { getDb } from "@/server/db";
import { offlineSyncConflicts, posShifts } from "@/server/db/schema";
import { env } from "@/server/env";
import type { UserRole } from "@/server/db/schema";

const NAV_BY_ROLE: Record<UserRole, NavGroup[]> = {
  SUPER_ADMIN: [
    {
      title: "Operasional",
      items: [
        { href: "/admin", label: "Dasbor", icon: "dashboard" },
        { href: "/pos", label: "Terminal Kasir", icon: "pos" },
        { href: "/pos/sync", label: "Sinkronisasi", icon: "sync" },
        { href: "/shifts", label: "Shift & Laci", icon: "shifts" },
        { href: "/transactions", label: "Transaksi", icon: "transactions" },
      ],
    },
    {
      title: "Katalog & Stok",
      items: [
        { href: "/products", label: "Produk", icon: "products" },
        { href: "/inventory", label: "Inventaris", icon: "inventory" },
        { href: "/customers", label: "Pelanggan", icon: "customers" },
        { href: "/promos", label: "Promo", icon: "promos" },
      ],
    },
    {
      title: "Analitik & Kontrol",
      items: [
        { href: "/dss", label: "DSS Ritel", icon: "dss" },
        { href: "/admin/audit", label: "Jejak Audit", icon: "audit" },
        { href: "/admin/settings", label: "Pengaturan", icon: "settings" },
      ],
    },
  ],
  STORE_MANAGER: [
    {
      title: "Operasional",
      items: [
        { href: "/admin", label: "Dasbor", icon: "dashboard" },
        { href: "/pos", label: "Terminal Kasir", icon: "pos" },
        { href: "/pos/sync", label: "Sinkronisasi", icon: "sync" },
        { href: "/shifts", label: "Shift & Laci", icon: "shifts" },
        { href: "/transactions", label: "Transaksi", icon: "transactions" },
      ],
    },
    {
      title: "Katalog & Stok",
      items: [
        { href: "/products", label: "Produk", icon: "products" },
        { href: "/inventory", label: "Inventaris", icon: "inventory" },
        { href: "/customers", label: "Pelanggan", icon: "customers" },
        { href: "/promos", label: "Promo", icon: "promos" },
      ],
    },
    {
      title: "Analitik & Kontrol",
      items: [
        { href: "/dss", label: "DSS Ritel", icon: "dss" },
        { href: "/admin/audit", label: "Jejak Audit", icon: "audit" },
      ],
    },
  ],
  CASHIER: [
    {
      title: "Terminal",
      items: [
        { href: "/pos", label: "Terminal Kasir", icon: "pos" },
        { href: "/pos/sync", label: "Sinkronisasi", icon: "sync" },
        { href: "/shifts", label: "Shift Saya", icon: "shifts" },
        { href: "/transactions", label: "Transaksi", icon: "transactions" },
      ],
    },
    {
      title: "Pelanggan",
      items: [{ href: "/customers", label: "Pelanggan", icon: "customers" }],
    },
  ],
  WAREHOUSE_STAFF: [
    {
      title: "Gudang",
      items: [
        { href: "/inventory", label: "Inventaris", icon: "inventory" },
        { href: "/products", label: "Katalog", icon: "products" },
      ],
    },
  ],
};

async function readTelemetry(userId: string) {
  const db = await getDb();
  const [conflictRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(offlineSyncConflicts)
    .where(eq(offlineSyncConflicts.resolved, false));
  const [shiftRow] = await db
    .select({ shiftNumber: posShifts.shiftNumber })
    .from(posShifts)
    .where(and(eq(posShifts.cashierId, userId), eq(posShifts.status, "OPEN")))
    .limit(1);

  return {
    pendingSync: Number(conflictRow?.count ?? 0),
    openShift: shiftRow?.shiftNumber ?? null,
    dbLabel: env.isDemoDatabase ? "PGlite" : "PostgreSQL",
  };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  let storeName = "Katalis Mart";
  try {
    storeName = (await getStoreSettings()).storeName;
  } catch {
    // Settings table not seeded yet; keep the default label.
  }
  const telemetry = await readTelemetry(user.id);
  const groups = NAV_BY_ROLE[user.role].map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.href === "/pos/sync" && telemetry.pendingSync ? { ...item, badge: telemetry.pendingSync } : item,
    ),
  }));

  const paletteItems: PaletteItem[] = [
    ...groups.flatMap((group) =>
      group.items.map((item) => ({
        label: item.label,
        hint: group.title,
        href: item.href,
        group: "Halaman" as const,
      })),
    ),
    {
      label: "Buka shift baru",
      hint: "Catat modal awal laci dan mulai berjualan",
      href: "/shifts",
      group: "Aksi",
      keywords: "shift laci kasir buka",
    },
    {
      label: "Terima barang dari supplier",
      hint: "Perbarui HPP rata-rata tertimbang",
      href: "/inventory/receiving",
      group: "Aksi",
      keywords: "purchase receiving stok masuk hpp",
    },
    {
      label: "Hitung fisik stok (opname)",
      hint: "Kirim dokumen opname untuk persetujuan",
      href: "/inventory/opname",
      group: "Aksi",
      keywords: "opname stock fisik gudang",
    },
    {
      label: "Rekomendasi restock mendesak",
      hint: "Prediksi kehabisan stok dan modal pembelian",
      href: "/dss/restock",
      group: "Modul",
      keywords: "dss restock reorder",
    },
    {
      label: "Anomali kas & erosi margin",
      hint: "Temuan yang menggerus laba",
      href: "/dss/anomalies",
      group: "Modul",
      keywords: "dss anomali margin dead stock",
    },
    {
      label: "Antrean & konflik sinkronisasi",
      hint: "Kirim struk luring dan rekonsiliasi stok",
      href: "/pos/sync",
      group: "Modul",
      keywords: "offline sinkron konflik queue",
    },
  ];

  return (
    <AppShell
      groups={groups}
      user={{ fullName: user.fullName, role: user.role }}
      storeName={storeName}
      telemetry={{ online: true, pendingSync: telemetry.pendingSync, dbLabel: telemetry.dbLabel, openShift: telemetry.openShift }}
      paletteItems={paletteItems}
    >
      {children}
    </AppShell>
  );
}
