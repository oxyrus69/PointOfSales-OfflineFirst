import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, Badge, Money, EmptyState, StatusBadge } from "@/components/ui";
import { ActivityStream, KpiStatCard, SegmentedHealthBar } from "@/components/kpi";
import { requirePageRole } from "@/server/rbac";
import {
  dashboardSummary,
  hourlySalesToday,
  categoryPerformance,
  paymentMix,
  shiftVarianceLeaderboard,
  topSellingProducts,
  salesTrend,
  yesterdayComparison,
} from "@/server/services/analytics";
import { buildDssReport } from "@/server/services/dssEngine";
import { listAuditLogs } from "@/server/services/audit";
import { listSyncConflicts } from "@/server/services/posSyncEngine";
import { formatDateTime, formatIdr, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Dasbor" };
export const dynamic = "force-dynamic";

const RELATIVE = (date: Date) => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
};

export default async function AdminPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const [summary, yesterday, trend, hourly, topProducts, payments, categories, variances, dss, audit, conflicts] =
    await Promise.all([
      dashboardSummary(),
      yesterdayComparison(),
      salesTrend(14),
      hourlySalesToday(),
      topSellingProducts(30, 6),
      paymentMix(30),
      categoryPerformance(30),
      shiftVarianceLeaderboard(5),
      buildDssReport(),
      listAuditLogs({ days: 7, limit: 8 }),
      listSyncConflicts({ includeResolved: false, limit: 20 }),
    ]);

  const dayDelta = yesterday.net > 0 ? ((summary.today.net - yesterday.net) / yesterday.net) * 100 : null;
  const peakHour = hourly.reduce((best, point) => (point.net > best.net ? point : best), { hour: 0, label: "—", net: 0 });
  const maxTrend = Math.max(1, ...trend.map((point) => point.net));
  const trendSeries = trend.map((point) => point.net);

  const criticalFindings = dss.restock.filter((item) => item.severity === "critical").length + dss.cashierRisk.length;
  const alertCount = conflicts.length + dss.totals.marginErosionCount + dss.totals.riskyCashierCount;

  const healthTotal = Math.max(1, summary.today.orders + dss.totals.urgentRestockCount + dss.totals.riskyCashierCount);

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Dasbor manajer"
        title="Kondisi toko hari ini"
        description="Penjualan, stok, laci kas, dan temuan keputusan dalam satu layar kerja."
        meta={
          <>
            <Badge tone={summary.openShift ? "signal" : "neutral"}>{summary.openShift ? `shift ${summary.openShift.shiftNumber}` : "tidak ada shift"}</Badge>
            <span className="num text-[0.75rem] text-ink-500">{formatDateTime(new Date())}</span>
          </>
        }
        actions={
          <>
            <Link href="/dss" className="btn btn-ghost">
              Rekomendasi DSS
            </Link>
            <Link href="/transactions" className="btn btn-primary">
              Riwayat transaksi
            </Link>
          </>
        }
      />

      {/* Contextual alert banner — only when something genuinely needs action */}
      {alertCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-caution-100 bg-caution-100 px-3 py-2 text-[0.8125rem] text-caution-700">
          <span className="font-semibold">{criticalFindings + conflicts.length} hal perlu tindakan hari ini</span>
          <span className="text-caution-700/80">
            {conflicts.length} konflik sinkron · {dss.totals.marginErosionCount} erosi margin · {dss.totals.riskyCashierCount} kasir berisiko
          </span>
          <Link href="/dss/anomalies" className="ml-auto underline underline-offset-2">
            Tinjau sekarang
          </Link>
        </div>
      ) : null}

      {/* Zone D1 — 4-layer KPI strip */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStatCard
          label="Penjualan hari ini"
          value={summary.today.net}
          delta={dayDelta}
          series={trendSeries.slice(-7)}
          tone={dayDelta !== null && dayDelta < 0 ? "warning" : "success"}
          footer={
            <>
              {summary.today.orders} struk · kemarin {formatIdr(yesterday.net)}
            </>
          }
        />
        <KpiStatCard
          label="Laba kotor hari ini"
          value={summary.today.grossProfit}
          series={trendSeries.slice(-7)}
          footer={
            <>
              HPP {formatIdr(summary.today.cogs)} · PPN {formatIdr(summary.today.tax)}
            </>
          }
        />
        <KpiStatCard
          label="Nilai stok (HPP)"
          value={summary.inventory.costValue}
          tone={summary.inventory.lowStock ? "warning" : "neutral"}
          footer={
            <>
              {formatNumber(summary.inventory.units)} unit ·{" "}
              <span className={summary.inventory.lowStock ? "text-caution-700" : ""}>{summary.inventory.lowStock} produk di bawah ambang</span>
            </>
          }
        />
        <KpiStatCard
          label="Modal dead stock"
          value={dss.totals.deadStockCapital}
          tone={dss.totals.deadStockCapital ? "danger" : "success"}
          footer={
            <>
              {dss.deadStock.length} produk lambat laku · restock butuh {formatIdr(dss.totals.restockCapitalNeeded)}
            </>
          }
        />
      </div>

      {/* Zone D2 + D3 — 8/4 split */}
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-8">
          <Panel
            title="Tren penjualan 14 hari"
            description="Penjualan neto harian, transaksi void tidak dihitung"
            actions={
              <span className="num text-[0.8125rem] font-medium">
                {formatIdr(trendSeries.reduce((sum, value) => sum + value, 0))}
              </span>
            }
          >
            <div className="flex h-[7.5rem] items-end gap-1">
              {trend.map((point) => {
                const height = Math.max(2, Math.round((point.net / maxTrend) * 100));
                return (
                  <div key={point.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className="w-full rounded-t-[2px] bg-ink-800 transition-colors group-hover:bg-flame-600"
                      style={{ height: `${height}%` }}
                      title={`${point.label}: ${formatIdr(point.net)} (${point.orders} struk)`}
                    />
                    <span className="num text-[0.5625rem] text-ink-500">{point.label.slice(0, 2)}</span>
                  </div>
                );
              })}
            </div>

            {/* Data matrix under the chart — printable and screen-reader readable */}
            <div className="scroll-thin mt-3 overflow-x-auto border-t border-ink-100 pt-2.5">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th className="text-right">Struk</th>
                    <th className="text-right">Penjualan neto</th>
                    <th className="text-right">Rata-rata/struk</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.slice(-7).map((point) => (
                    <tr key={point.date}>
                      <td className="num text-[0.75rem]">{point.date}</td>
                      <td className="num text-right text-[0.75rem]">{point.orders}</td>
                      <td className="num text-right text-[0.75rem]">{formatIdr(point.net)}</td>
                      <td className="num text-right text-[0.75rem] text-ink-600">
                        {point.orders ? formatIdr(Math.round(point.net / point.orders)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Antrean prioritas"
            description="Struk yang perlu diputuskan atau diperiksa hari ini"
            actions={
              <Link href="/transactions" className="btn btn-ghost py-1 text-[0.75rem]">
                Semua transaksi
              </Link>
            }
            flush
          >
            {variances.length === 0 ? (
              <div className="px-3.5 py-5">
                <EmptyState title="Tidak ada selisih kas" description="Semua shift tertutup cocok dengan catatan sistem." />
              </div>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Shift</th>
                      <th>Kasir</th>
                      <th>Status</th>
                      <th className="text-right">Selisih</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variances.map((shift) => (
                      <tr key={shift.shiftNumber}>
                        <td className="num text-[0.75rem] font-medium">{shift.shiftNumber}</td>
                        <td className="text-[0.75rem]">{shift.cashierName ?? "-"}</td>
                        <td>
                          <StatusBadge value={shift.status} />
                        </td>
                        <td className={`num text-right text-[0.75rem] ${shift.variance < 0 ? "text-alert-700" : "text-caution-700"}`}>
                          {formatIdr(shift.variance)}
                        </td>
                        <td className="text-right">
                          <Link href="/shifts" className="btn btn-ghost py-0.5 text-[0.6875rem]">
                            Inspeksi
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* Zone D3 — telemetry & DSS rail */}
        <div className="space-y-3 lg:col-span-4">
          <Panel title="Keputusan prioritas" description="Dihitung ulang setiap halaman dibuka">
            {dss.restock.length + dss.marginErosion.length + dss.cashierRisk.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-500">Tidak ada temuan terbuka.</p>
            ) : (
              <ul className="space-y-2">
                {[
                  ...dss.marginErosion.slice(0, 1).map((item) => ({ ...item, href: "/dss/anomalies" })),
                  ...dss.cashierRisk.slice(0, 1).map((item) => ({ ...item, href: "/dss/anomalies" })),
                  ...dss.restock.slice(0, 2).map((item) => ({ ...item, href: "/dss/restock" })),
                ].map((item) => (
                  <li key={`${item.ruleCode}-${item.subjectId}`}>
                    <Link
                      href={item.href}
                      className="block rounded-sm border border-ink-100 px-2.5 py-2 transition-colors hover:border-ink-300 hover:bg-ink-50"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge tone={item.severity === "critical" ? "alert" : item.severity === "warning" ? "caution" : "signal"}>
                          {item.severity}
                        </Badge>
                        <span className="num text-[0.625rem] text-ink-500">{item.ruleCode.replace(/_/g, " ")}</span>
                      </div>
                      <p className="mt-1 text-[0.8125rem] font-medium leading-snug">{item.headline}</p>
                      <p className="truncate text-[0.75rem] text-ink-600">{item.subjectLabel}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Kesehatan operasional">
            <SegmentedHealthBar
              segments={[
                { label: "Struk selesai", value: summary.today.orders, tone: "success" },
                { label: "Perlu restock", value: dss.totals.urgentRestockCount, tone: "warning" },
                { label: "Kasir berisiko", value: dss.totals.riskyCashierCount, tone: "danger" },
                { label: "Sisa", value: Math.max(0, healthTotal - summary.today.orders - dss.totals.urgentRestockCount - dss.totals.riskyCashierCount), tone: "neutral" },
              ]}
            />
          </Panel>

          <Panel title="Aktivitas terakhir" description="7 hari">
            <ActivityStream
              items={audit.slice(0, 6).map((log) => ({
                title: `${log.action.replace(/_/g, " ")}${log.actorName ? ` · ${log.actorName}` : ""}`,
                meta: `${RELATIVE(log.createdAt)} · ${log.entityType}`,
                tone: log.severity === "CRITICAL" ? "danger" : log.severity === "WARNING" ? "warning" : "info",
              }))}
            />
          </Panel>
        </div>
      </div>

      {/* Zone D2 lower — distribution tables */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Produk paling laku" description="30 hari" flush>
          {topProducts.length === 0 ? (
            <p className="px-3.5 py-5 text-[0.8125rem] text-ink-500">Belum ada penjualan.</p>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th className="text-right">Unit</th>
                    <th className="text-right">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, index) => (
                    <tr key={product.productId || index}>
                      <td className="max-w-[18ch] truncate text-[0.75rem]">{product.name}</td>
                      <td className="num text-right text-[0.75rem]">{product.qty}</td>
                      <td className="num text-right text-[0.75rem]">{formatIdr(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Metode bayar" description="30 hari" flush>
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metode</th>
                  <th className="text-right">Transaksi</th>
                  <th className="text-right">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.method}>
                    <td className="text-[0.75rem]">{payment.method.replace(/_/g, " ")}</td>
                    <td className="num text-right text-[0.75rem]">{payment.count}</td>
                    <td className="num text-right text-[0.75rem]">{formatIdr(payment.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Kategori" description="Kontribusi 30 hari" flush>
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th className="text-right">Unit</th>
                  <th className="text-right">Omzet</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.category}>
                    <td className="max-w-[16ch] truncate text-[0.75rem]">{category.category}</td>
                    <td className="num text-right text-[0.75rem]">{category.qty}</td>
                    <td className="num text-right text-[0.75rem]">{formatIdr(category.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Jam tersibuk hari ini" description={`Puncak ${peakHour.label} · ${formatIdr(peakHour.net)}`} className="lg:col-span-8">
          <div className="flex h-20 items-end gap-0.5">
            {hourly
              .filter((point) => point.hour >= 6 && point.hour <= 22)
              .map((point) => {
                const max = Math.max(1, ...hourly.map((item) => item.net));
                return (
                  <div key={point.hour} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className={`w-full rounded-t-[2px] ${point.net > 0 ? "bg-flame-600" : "bg-ink-100"}`}
                      style={{ height: `${Math.max(2, Math.round((point.net / max) * 100))}%` }}
                      title={`${point.label}: ${formatIdr(point.net)}`}
                    />
                    <span className="num text-[0.5rem] text-ink-400">{String(point.hour).padStart(2, "0")}</span>
                  </div>
                );
              })}
          </div>
        </Panel>

        <Panel title="Shift terbuka" className="lg:col-span-4">
          {summary.openShift ? (
            <dl className="space-y-1 text-[0.75rem]">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-600">Nomor</dt>
                <dd className="num font-medium">{summary.openShift.shiftNumber}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-600">Kasir</dt>
                <dd>{summary.openShift.cashierName ?? "-"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-600">Modal awal</dt>
                <dd>
                  <Money value={summary.openShift.openingCash} />
                </dd>
              </div>
              <Link href={`/shifts/${summary.openShift.id}`} className="btn btn-ghost mt-2 w-full py-1 text-[0.75rem]">
                Buka rincian shift
              </Link>
            </dl>
          ) : (
            <EmptyState title="Tidak ada shift terbuka" description="Terminal tidak bisa membayar sampai shift dibuka." />
          )}
        </Panel>
      </div>
    </div>
  );
}
