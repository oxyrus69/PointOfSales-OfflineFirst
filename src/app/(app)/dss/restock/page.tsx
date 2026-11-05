import type { Metadata } from "next";
import { PageHeader, Panel, Stat, SectionTabs, EmptyState, Money } from "@/components/ui";
import { RecommendationCard } from "@/components/recommendation-card";
import { requirePageRole } from "@/server/rbac";
import { buildDssReport } from "@/server/services/dssEngine";
import { formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "DSS · Restock" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/dss", label: "Ringkasan" },
  { href: "/dss/restock", label: "Restock" },
  { href: "/dss/anomalies", label: "Anomali" },
  { href: "/dss/riwayat", label: "Riwayat" },
];

export default async function DssRestockPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const report = await buildDssReport();
  const items = report.restock;
  const capital = items.reduce((sum, item) => sum + Number(item.payload.capital ?? 0), 0);
  const critical = items.filter((item) => item.severity === "critical");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="DSS · prediksi kehabisan stok"
        title="Rencana pemesanan ulang"
        description="Perhitungan memakai laju jual 30 hari dan lead time supplier. Produk tanpa penjualan tetap dimasukkan bila stoknya sudah menyentuh titik pesan ulang."
      />
      <SectionTabs items={TABS} active="/dss/restock" />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <Stat label="Produk perlu dipesan" value={items.length} tone={items.length ? "caution" : "grove"} />
        <Stat label="Modal dibutuhkan" value={<Money value={capital} />} hint="Berdasarkan HPP saat ini" />
        <Stat label="Stok habis" value={critical.length} tone={critical.length ? "alert" : "grove"} hint="Tidak bisa dijual sama sekali" />
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState title="Belum perlu memesan" description="Semua produk masih di atas titik pesan ulang dan cover stok melewati lead time." />
        </Panel>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <RecommendationCard key={item.subjectId} item={item} />
          ))}
        </div>
      )}

      <Panel title="Cara membaca angka saran pesan">
        <p className="text-[0.8125rem] leading-relaxed text-ink-700">
          Saran pesan = jumlah pesan ulang standar produk, atau selisih ke titik pesan ulang ditambah satu siklus pesan
          ulang, mana yang lebih besar. Modal dihitung dari HPP rata-rata tertimbang yang berlaku sekarang, bukan harga
          beli terakhir.
        </p>
      </Panel>
    </div>
  );
}
