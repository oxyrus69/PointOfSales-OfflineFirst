import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@/components/ui";
import { PinForm, SettingsForm } from "@/components/settings-forms";
import { requirePageRole } from "@/server/rbac";
import { getStoreSettings } from "@/server/services/settings";
import { listStaff } from "@/server/services/audit";
import { env } from "@/server/env";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Pengaturan" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageRole("SUPER_ADMIN");
  const [settings, staff] = await Promise.all([getStoreSettings(), listStaff()]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Konfigurasi toko"
        title="Pengaturan sistem"
        description="Nilai di sini mengubah perilaku kasir, batas otorisasi, dan perhitungan pajak. Perubahan berlaku saat terminal berikutnya mengambil snapshot."
        actions={<Badge tone={env.isDemoDatabase ? "caution" : "grove"}>{env.isDemoDatabase ? "mode demo · PGlite" : "mode server · PostgreSQL"}</Badge>}
      />

      <Panel title="Identitas & kebijakan transaksi">
        <SettingsForm settings={settings} />
      </Panel>

      <Panel title="Staf & PIN supervisor" description="PIN 6 digit dipakai untuk void, retur, diskon besar, dan kas keluar">
        <div className="scroll-thin overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Peran</th>
                <th>Status</th>
                <th>PIN</th>
                <th>Terdaftar</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id}>
                  <td className="text-[0.8125rem] font-medium">{member.fullName}</td>
                  <td className="num text-[0.75rem] text-ink-600">{member.email}</td>
                  <td>
                    <Badge tone={member.role === "SUPER_ADMIN" ? "accent" : member.role === "STORE_MANAGER" ? "signal" : "neutral"}>
                      {member.role.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={member.isActive ? "grove" : "neutral"}>{member.isActive ? "aktif" : "nonaktif"}</Badge>
                  </td>
                  <td>
                    {["SUPER_ADMIN", "STORE_MANAGER"].includes(member.role) ? (
                      <PinForm userId={member.id} hasPin={Boolean(member.hasPin)} />
                    ) : (
                      <span className="text-[0.75rem] text-ink-400">tidak berlaku</span>
                    )}
                  </td>
                  <td className="num text-[0.75rem] text-ink-500">{formatDateTime(member.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Catatan keamanan">
        <ul className="space-y-2 text-[0.8125rem] leading-relaxed text-ink-700">
          <li>
            <span className="font-medium">Kunci sesi dan struk.</span>{" "}
            {env.isDemoDatabase
              ? "Mode demo memakai kunci deterministik agar pengujian langsung jalan. Jangan pakai mode ini di produksi."
              : "Kunci dibaca dari SESSION_SECRET dan RECEIPT_SIGNING_KEY."}{" "}
            Jalankan <span className="num">npm run secrets:generate</span> untuk membuat kunci acak.
          </li>
          <li>
            <span className="font-medium">Kata sandi dan PIN.</span> Disimpan sebagai hash scrypt dengan salt unik per
            baris. PIN tidak pernah dikirim balik ke klien, hanya status ada atau tidak.
          </li>
          <li>
            <span className="font-medium">Basis data.</span>{" "}
            {env.isDemoDatabase
              ? `PGlite tersimpan di ${env.pglitePath}. Untuk produksi, set DATABASE_URL=postgres://… tanpa mengubah kode.`
              : "Koneksi PostgreSQL Server aktif dengan connection pool."}
          </li>
        </ul>
      </Panel>
    </div>
  );
}
