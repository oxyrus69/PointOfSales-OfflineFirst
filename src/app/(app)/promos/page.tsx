import type { Metadata } from "next";
import { PageHeader, Panel, Stat, Badge } from "@/components/ui";
import { requirePageRole } from "@/server/rbac";
import { listPromos } from "@/server/services/promos";
import { formatDateShort, formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "Promo" };
export const dynamic = "force-dynamic";

export default async function PromosPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const promos = await listPromos();
  const now = new Date();
  const active = promos.filter((promo) => promo.isActive && promo.validFrom <= now && promo.validUntil >= now);
  const scheduled = promos.filter((promo) => promo.isActive && promo.validFrom > now);
  const expired = promos.filter((promo) => promo.validUntil < now);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Diskon & voucher"
        title="Kode promo"
        description="Promo dihitung setelah diskon member, dibatasi plafon rupiah. Tanpa plafon, satu kode persentase bisa menggerus seluruh margin."
      />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <Stat label="Promo aktif" value={active.length} tone="grove" hint="Berlaku hari ini" />
        <Stat label="Terjadwal" value={scheduled.length} hint="Belum mulai" />
        <Stat label="Kedaluwarsa" value={expired.length} hint="Tidak bisa dipakai kasir" />
      </div>

      <Panel title="Semua kode promo" flush>
        <div className="scroll-thin overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Jenis</th>
                <th className="text-right">Nilai</th>
                <th className="text-right">Min. belanja</th>
                <th className="text-right">Plafon</th>
                <th>Berlaku</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => {
                const status = !promo.isActive
                  ? { label: "nonaktif", tone: "neutral" as const }
                  : promo.validFrom > now
                    ? { label: "terjadwal", tone: "signal" as const }
                    : promo.validUntil < now
                      ? { label: "kedaluwarsa", tone: "neutral" as const }
                      : { label: "aktif", tone: "grove" as const };
                return (
                  <tr key={promo.id}>
                    <td className="num text-[0.8125rem] font-semibold">{promo.code}</td>
                    <td className="max-w-[24ch] text-[0.8125rem]">{promo.name}</td>
                    <td className="text-[0.75rem] text-ink-600">{promo.discountType === "PERCENTAGE" ? "Persentase" : "Potongan tetap"}</td>
                    <td className="num text-right text-[0.8125rem]">
                      {promo.discountType === "PERCENTAGE" ? `${promo.discountValue}%` : formatIdr(promo.discountValue)}
                    </td>
                    <td className="num text-right text-[0.8125rem]">{formatIdr(promo.minSubtotal)}</td>
                    <td className="num text-right text-[0.8125rem]">{promo.maxDiscountCap > 0 ? formatIdr(promo.maxDiscountCap) : "tanpa plafon"}</td>
                    <td className="num text-[0.75rem] text-ink-600">
                      {formatDateShort(promo.validFrom)} — {formatDateShort(promo.validUntil)}
                    </td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Urutan perhitungan diskon" description="Berlaku identik di terminal luring dan validasi server">
        <ol className="space-y-2 text-[0.8125rem] leading-relaxed text-ink-700">
          <li>
            <span className="num mr-1.5 text-ink-400">01</span> Harga satuan dari tier grosir yang syaratnya terpenuhi.
          </li>
          <li>
            <span className="num mr-1.5 text-ink-400">02</span> Diskon member dipotong dari subtotal setelah harga grosir.
          </li>
          <li>
            <span className="num mr-1.5 text-ink-400">03</span> Promo dihitung dari sisa setelah diskon member, dibatasi plafon.
          </li>
          <li>
            <span className="num mr-1.5 text-ink-400">04</span> Diskon manual kasir, dengan ambang PIN supervisor.
          </li>
          <li>
            <span className="num mr-1.5 text-ink-400">05</span> PPN proporsional hanya untuk item kena pajak, lalu pembulatan tunai Rp 100.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
