import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, Stat, Badge, EmptyState, SectionTabs, Money } from "@/components/ui";
import { RecommendationCard } from "@/components/recommendation-card";
import { requirePageRole } from "@/server/rbac";
import { buildDssReport } from "@/server/services/dssEngine";
import { formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "DSS Ritel" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/dss", label: "Ringkasan" },
  { href: "/dss/restock", label: "Restock" },
  { href: "/dss/anomalies", label: "Anomali" },
  { href: "/dss/riwayat", label: "Riwayat" },
];

export default async function DssPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const report = await buildDssReport();

  const all = [...report.restock, ...report.deadStock, ...report.marginErosion, ...report.cashierRisk];
  const critical = all.filter((item) => item.severity === "critical");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sistem pendukung keputusan"
        title="Keputusan ritel hari ini"
        description="Semua rekomendasi dihitung ulang dari data transaksi dan kartu stok setiap halaman dibuka. Tidak ada angka yang disimpan sebagai opini lama."
      />
      <SectionTabs items={TABS} active="/dss" />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Restock mendesak" value={report.totals.urgentRestockCount} tone={report.totals.urgentRestockCount ? "caution" : "grove"} hint={`Butuh modal ${formatIdr(report.totals.restockCapitalNeeded)}`} />
        <Stat label="Modal dead stock" value={<Money value={report.totals.deadStockCapital} />} tone={report.totals.deadStockCapital ? "alert" : "grove"} hint={`${report.deadStock.length} produk lambat laku`} />
        <Stat label="Erosi margin" value={report.totals.marginErosionCount} tone={report.totals.marginErosionCount ? "alert" : "grove"} hint="Margin di bawah batas produk" />
        <Stat label="Kasir berisiko" value={report.totals.riskyCashierCount} tone={report.totals.riskyCashierCount ? "caution" : "grove"} hint="Selisih kas atau rasio void tinggi" />
      </div>

      {all.length === 0 ? (
        <Panel>
          <EmptyState
            title="Tidak ada rekomendasi terbuka"
            description="Stok, margin, dan laci kas dalam kondisi sehat menurut aturan yang aktif."
          />
        </Panel>
      ) : (
        <>
          {critical.length ? (
            <Panel title="Perlu tindakan hari ini" description={`${critical.length} temuan berprioritas tertinggi`}>
              <div className="space-y-2.5">
                {critical.slice(0, 4).map((item) => (
                  <RecommendationCard key={`${item.ruleCode}-${item.subjectId}`} item={item} />
                ))}
              </div>
            </Panel>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Restock" description={`${report.restock.length} produk`} actions={<Link href="/dss/restock" className="btn btn-ghost py-1 text-[0.75rem]">Buka</Link>}>
              {report.restock.length === 0 ? (
                <p className="text-[0.8125rem] text-ink-500">Semua stok di atas ambang aman.</p>
              ) : (
                <ul className="space-y-2 text-[0.8125rem]">
                  {report.restock.slice(0, 5).map((item) => (
                    <li key={item.subjectId} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1.5 last:border-0">
                      <span className="min-w-0 truncate">{item.subjectLabel}</span>
                      <span className="num shrink-0 text-ink-600">{item.metrics[0]?.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Dead stock" description={`${report.deadStock.length} produk`}>
              {report.deadStock.length === 0 ? (
                <p className="text-[0.8125rem] text-ink-500">Tidak ada modal tertahan besar.</p>
              ) : (
                <ul className="space-y-2 text-[0.8125rem]">
                  {report.deadStock.slice(0, 5).map((item) => (
                    <li key={item.subjectId} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1.5 last:border-0">
                      <span className="min-w-0 truncate">{item.subjectLabel}</span>
                      <span className="num shrink-0 text-alert-700">{item.headline}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Erosi margin" description={`${report.marginErosion.length} produk`}>
              {report.marginErosion.length === 0 ? (
                <p className="text-[0.8125rem] text-ink-500">Semua produk di atas margin minimum.</p>
              ) : (
                <ul className="space-y-2 text-[0.8125rem]">
                  {report.marginErosion.map((item) => (
                    <li key={item.subjectId} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1.5 last:border-0">
                      <span className="min-w-0 truncate">{item.subjectLabel}</span>
                      <span className="num shrink-0">{item.metrics[0]?.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Anomali kasir" description={`${report.cashierRisk.length} staf`}>
              {report.cashierRisk.length === 0 ? (
                <p className="text-[0.8125rem] text-ink-500">Tidak ada pola selisih kas mencurigakan.</p>
              ) : (
                <ul className="space-y-2 text-[0.8125rem]">
                  {report.cashierRisk.map((item) => (
                    <li key={item.subjectId} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1.5 last:border-0">
                      <span className="min-w-0 truncate">{item.subjectLabel}</span>
                      <span className="num shrink-0 text-caution-700">{item.headline}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      <Panel title="Cara sistem mengambil keputusan">
        <ul className="grid gap-3 text-[0.8125rem] leading-relaxed text-ink-700 sm:grid-cols-2">
          <li>
            <Badge tone="caution">Restock</Badge>
            <p className="mt-1.5">Stok ≤ titik pesan ulang, atau sisa hari stok ≤ lead time supplier (default 5 hari) berdasarkan laju jual 30 hari.</p>
          </li>
          <li>
            <Badge tone="alert">Dead stock</Badge>
            <p className="mt-1.5">Terjual kurang dari 2 unit dalam 30 hari padahal modal tertahan ≥ Rp 1.000.000.</p>
          </li>
          <li>
            <Badge tone="alert">Erosi margin</Badge>
            <p className="mt-1.5">Margin kotor turun di bawah batas minimum produk akibat kenaikan harga beli.</p>
          </li>
          <li>
            <Badge tone="caution">Anomali kasir</Badge>
            <p className="mt-1.5">Akumulasi selisih kas ≤ −Rp 50.000 atau rasio nilai void/retur di atas ambang dalam 14 hari.</p>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
