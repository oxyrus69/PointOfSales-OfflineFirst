import type { Metadata } from "next";
import { PageHeader, Panel, Stat, SectionTabs, EmptyState, Money } from "@/components/ui";
import { RecommendationCard } from "@/components/recommendation-card";
import { requirePageRole } from "@/server/rbac";
import { buildDssReport } from "@/server/services/dssEngine";

export const metadata: Metadata = { title: "DSS · Anomali" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/dss", label: "Ringkasan" },
  { href: "/dss/restock", label: "Restock" },
  { href: "/dss/anomalies", label: "Anomali" },
  { href: "/dss/riwayat", label: "Riwayat" },
];

export default async function DssAnomaliesPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const report = await buildDssReport();

  const totalDeadCapital = report.deadStock.reduce((sum, item) => sum + Number(item.payload.lockedCapital ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="DSS · anomali & margin"
        title="Temuan yang menggerus laba"
        description="Tiga pola yang paling sering tidak terlihat di laporan penjualan biasa: modal tertahan, margin tergerus, dan perilaku kasir yang menyimpang."
      />
      <SectionTabs items={TABS} active="/dss/anomalies" />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <Stat label="Modal dead stock" value={<Money value={totalDeadCapital} />} tone={totalDeadCapital ? "alert" : "grove"} hint={`${report.deadStock.length} produk`} />
        <Stat label="Erosi margin" value={report.marginErosion.length} tone={report.marginErosion.length ? "alert" : "grove"} />
        <Stat label="Kasir berisiko" value={report.cashierRisk.length} tone={report.cashierRisk.length ? "caution" : "grove"} />
      </div>

      <Panel title="Modal tertahan (dead stock)" description="Terjual < 2 unit dalam 30 hari dengan modal ≥ Rp 1 juta">
        {report.deadStock.length === 0 ? (
          <EmptyState title="Tidak ada modal tertahan besar" />
        ) : (
          <div className="space-y-2.5">
            {report.deadStock.map((item) => (
              <RecommendationCard key={item.subjectId} item={item} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Erosi margin harga jual" description="Margin kotor di bawah batas minimum produk">
        {report.marginErosion.length === 0 ? (
          <EmptyState title="Semua margin sehat" />
        ) : (
          <div className="space-y-2.5">
            {report.marginErosion.map((item) => (
              <RecommendationCard key={item.subjectId} item={item} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Anomali kasir" description="Selisih kas menumpuk atau rasio void tinggi dalam 14 hari">
        {report.cashierRisk.length === 0 ? (
          <EmptyState title="Tidak ada pola menyimpang" />
        ) : (
          <div className="space-y-2.5">
            {report.cashierRisk.map((item) => (
              <RecommendationCard key={item.subjectId} item={item} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Catatan interpretasi">
        <p className="text-[0.8125rem] leading-relaxed text-ink-700">
          Temuan di halaman ini adalah sinyal, bukan putusan. Selisih kas bisa berasal dari kembalian yang salah hitung,
          dan rasio void tinggi bisa muncul pada shift dengan banyak pembatalan sah. Yang membuat sinyal ini berguna
          adalah semuanya sudah terhubung ke struk, shift, dan otorisasi supervisor sehingga bisa diperiksa langsung.
        </p>
      </Panel>
    </div>
  );
}
