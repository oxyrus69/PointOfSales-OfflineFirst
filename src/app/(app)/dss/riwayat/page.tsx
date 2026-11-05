import type { Metadata } from "next";
import { PageHeader, Panel, SectionTabs, StatusBadge, EmptyState, Badge } from "@/components/ui";
import { DecisionStatusButtons } from "@/components/dss-actions";
import { requirePageRole } from "@/server/rbac";
import { listDecisionHistory } from "@/server/services/dssEngine";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "DSS · Riwayat" };
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/dss", label: "Ringkasan" },
  { href: "/dss/restock", label: "Restock" },
  { href: "/dss/anomalies", label: "Anomali" },
  { href: "/dss/riwayat", label: "Riwayat" },
];

export default async function DssHistoryPage() {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER");
  const history = await listDecisionHistory(80);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="DSS · jejak keputusan"
        title="Riwayat rekomendasi"
        description="Rekomendasi yang ditandai akan tersimpan bersama payload saat itu. Ini memisahkan keputusan yang diambil dari data yang berubah di kemudian hari."
      />
      <SectionTabs items={TABS} active="/dss/riwayat" />

      <Panel title="Keputusan tercatat" description={`${history.length} baris terakhir`} flush>
        {history.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              title="Belum ada rekomendasi yang ditandai"
              description="Buka halaman DSS dan tekan 'Tandai ditangani' pada rekomendasi yang ingin dilacak."
            />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Aturan</th>
                  <th>Subjek</th>
                  <th>Status</th>
                  <th>Ditangani oleh</th>
                  <th className="text-right">Ubah status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="num text-[0.8125rem] text-ink-600">{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <Badge tone="neutral">{entry.ruleCode.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="max-w-[28ch] truncate text-[0.8125rem]">{entry.subjectLabel}</td>
                    <td>
                      <StatusBadge value={entry.status} />
                    </td>
                    <td className="text-[0.8125rem] text-ink-600">
                      {entry.actedByName ?? "—"}
                      {entry.actedAt ? <span className="num block text-[0.6875rem] text-ink-500">{formatDateTime(entry.actedAt)}</span> : null}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end">
                        <DecisionStatusButtons decisionId={entry.id} />
                      </div>
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
