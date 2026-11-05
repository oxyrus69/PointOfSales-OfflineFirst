import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, Stat, StatusBadge, Money, Badge, EmptyState } from "@/components/ui";
import { OpenShiftForm } from "@/components/open-shift-form";
import { requirePageUser } from "@/server/rbac";
import { findOpenShift, listShifts } from "@/server/services/shiftEngine";
import { formatDateTime, toNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Shift & Laci" };
export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const user = await requirePageUser();
  const [openShift, shifts] = await Promise.all([findOpenShift(user.id), listShifts(40)]);

  const canOpen = user.role === "CASHIER" || user.role === "STORE_MANAGER" || user.role === "SUPER_ADMIN";
  const mine = shifts.filter((shift) => shift.cashierId === user.id);
  const visible = user.role === "CASHIER" ? mine : shifts;

  const totalVariance = visible.reduce((sum, shift) => sum + toNumber(shift.cashVariance), 0);
  const withVariance = visible.filter((shift) => toNumber(shift.cashVariance) !== 0 && shift.status !== "OPEN").length;
  const activeCash = openShift ? toNumber(openShift.openingCash) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Kas & laci"
        title="Shift dan rekonsiliasi laci"
        description="Tutup shift memakai blind drop: kasir memasukkan uang fisik yang dihitung, sistem baru membandingkan dengan angka yang seharusnya. Angka sistem tidak pernah tampil sebelum kasir menghitung."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shift berjalan" value={openShift ? openShift.shiftNumber : "—"} hint={openShift ? `Dibuka ${formatDateTime(openShift.openedAt)}` : "Tidak ada shift aktif milik Anda"} tone={openShift ? "signal" : "neutral"} />
        <Stat label="Modal di laci" value={<Money value={activeCash} />} hint="Uang kembalian awal shift aktif" />
        <Stat label="Shift berselisih" value={withVariance} hint="Dari riwayat yang terlihat di akun ini" tone={withVariance ? "caution" : "grove"} />
        <Stat
          label="Akumulasi selisih"
          value={<Money value={totalVariance} />}
          hint={totalVariance < 0 ? "Total kas kurang dari catatan sistem" : "Total kas lebih dari catatan sistem"}
          tone={totalVariance < 0 ? "alert" : "neutral"}
        />
      </div>

      {canOpen ? (
        <Panel title="Buka shift baru" description="Kasir wajib punya satu shift OPEN sebelum tombol bayar di terminal aktif.">
          <OpenShiftForm hasOpenShift={Boolean(openShift)} shiftNumber={openShift?.shiftNumber ?? null} />
        </Panel>
      ) : null}

      <Panel title="Riwayat shift" description="Klik satu baris untuk melihat rincian laci, pergerakan kas, dan laporan Z." flush>
        {visible.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState title="Belum ada shift" description="Buka shift pertama untuk mulai berjualan." />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Kasir</th>
                  <th>Terminal</th>
                  <th>Status</th>
                  <th>Dibuka</th>
                  <th className="text-right">Penjualan neto</th>
                  <th className="text-right">Selisih kas</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {visible.map((shift) => {
                  const variance = toNumber(shift.cashVariance);
                  return (
                    <tr key={shift.id}>
                      <td className="num text-[0.8125rem] font-medium">{shift.shiftNumber}</td>
                      <td className="text-[0.8125rem]">{shift.cashierName ?? "-"}</td>
                      <td className="num text-[0.8125rem] text-ink-600">{shift.terminalId}</td>
                      <td>
                        <StatusBadge value={shift.status} />
                      </td>
                      <td className="num text-[0.8125rem] text-ink-600">{formatDateTime(shift.openedAt)}</td>
                      <td className="num text-right text-[0.8125rem]">{formatCurrencySafe(shift.totalNetSales)}</td>
                      <td className={`num text-right text-[0.8125rem] ${variance < 0 ? "text-alert-700" : variance > 0 ? "text-caution-700" : "text-ink-500"}`}>
                        {shift.cashVariance === null ? "—" : formatCurrencySafe(variance)}
                      </td>
                      <td className="text-right">
                        <Link href={`/shifts/${shift.id}`} className="btn btn-ghost py-1 text-[0.75rem]">
                          Rincian
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Aturan rekonsiliasi" description="Yang membedakan laci kasir dari dompet pribadi">
        <ul className="grid gap-2.5 text-[0.8125rem] leading-relaxed text-ink-700 sm:grid-cols-2">
          <li>
            <Badge tone="signal">Blind drop</Badge>
            <p className="mt-1.5">
              Kasir menghitung uang fisik lebih dulu. Sistem baru menampilkan selisih setelah kasir menekan tutup shift.
            </p>
          </li>
          <li>
            <Badge tone="caution">Selisih besar</Badge>
            <p className="mt-1.5">
              Selisih di atas batas toleransi mewajibkan PIN Supervisor dan otomatis tercatat di jejak audit serta DSS.
            </p>
          </li>
          <li>
            <Badge tone="accent">Kas keluar besar</Badge>
            <p className="mt-1.5">
              Pengeluaran laci di atas ambang (default Rp 100.000) memakai PIN Supervisor, sehingga tidak bisa dipakai
              untuk mengambil uang tanpa jejak.
            </p>
          </li>
          <li>
            <Badge tone="grove">Audit</Badge>
            <p className="mt-1.5">
              Manajer menandai shift berselisih sebagai teraudit setelah bukti ditemukan, lalu statusnya terkunci.
            </p>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function formatCurrencySafe(value: unknown): string {
  const amount = toNumber(value);
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
