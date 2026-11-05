import type { Metadata } from "next";
import { PageHeader, Panel, Stat, Badge, EmptyState } from "@/components/ui";
import { requirePageRole } from "@/server/rbac";
import { auditStats, listAuditLogs } from "@/server/services/audit";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Jejak Audit" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, "neutral" | "caution" | "alert"> = {
  INFO: "neutral",
  WARNING: "caution",
  CRITICAL: "alert",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; days?: string }>;
}) {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const params = await searchParams;
  const severity = ["INFO", "WARNING", "CRITICAL"].includes(params.severity ?? "") ? params.severity : undefined;
  const days = params.days === "7" || params.days === "90" ? Number(params.days) : 30;

  const [logs, stats] = await Promise.all([
    listAuditLogs({ severity, days, limit: 250 }),
    auditStats(days),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Kontrol internal"
        title="Jejak audit"
        description="Setiap aksi finansial, stok, dan otorisasi tercatat dengan aktor, supervisor pemberi izin, dan payload saat kejadian."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Aktivitas ${days} hari`} value={stats.total} />
        <Stat label="Peringatan" value={stats.warning} tone={stats.warning ? "caution" : "grove"} />
        <Stat label="Kritis" value={stats.critical} tone={stats.critical ? "alert" : "grove"} />
        <Stat label="Butuh izin supervisor" value={stats.supervisorActions} hint="Void, retur, diskon besar, kas keluar" />
      </div>

      <form className="panel flex flex-wrap items-end gap-2 px-4 py-3" action="/admin/audit">
        <label>
          <span className="label-xs">Tingkat</span>
          <select name="severity" defaultValue={severity ?? ""} className="field mt-1.5">
            <option value="">Semua</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Peringatan</option>
            <option value="CRITICAL">Kritis</option>
          </select>
        </label>
        <label>
          <span className="label-xs">Rentang</span>
          <select name="days" defaultValue={String(days)} className="field mt-1.5">
            <option value="7">7 hari</option>
            <option value="30">30 hari</option>
            <option value="90">90 hari</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary">
          Terapkan
        </button>
      </form>

      <Panel title="Catatan audit" description={`${logs.length} baris terbaru`} flush>
        {logs.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState title="Tidak ada catatan pada filter ini" description="Coba rentang waktu yang lebih panjang." />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Aksi</th>
                  <th>Aktor</th>
                  <th>Izin supervisor</th>
                  <th>Entitas</th>
                  <th>Tingkat</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="num text-[0.75rem] text-ink-600">{formatDateTime(log.createdAt)}</td>
                    <td className="num text-[0.8125rem] font-medium">{log.action}</td>
                    <td className="text-[0.8125rem]">
                      {log.actorName ?? "sistem"}
                      {log.actorRole ? <span className="block text-[0.625rem] text-ink-500">{log.actorRole}</span> : null}
                    </td>
                    <td className="text-[0.8125rem]">{log.authorizedByName ?? "—"}</td>
                    <td className="text-[0.75rem] text-ink-600">
                      {log.entityType}
                      {log.entityId ? <span className="num block max-w-[14ch] truncate text-[0.625rem]">{log.entityId}</span> : null}
                    </td>
                    <td>
                      <Badge tone={SEVERITY_TONE[log.severity] ?? "neutral"}>{log.severity}</Badge>
                    </td>
                    <td className="max-w-[30ch]">
                      <details>
                        <summary className="cursor-pointer text-[0.75rem] text-ink-600">lihat payload</summary>
                        <pre className="num mt-1 max-w-[46ch] whitespace-pre-wrap break-all rounded-xs bg-ink-50 p-1.5 text-[0.625rem] text-ink-700">
                          {JSON.stringify(log.metadata, null, 1)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
