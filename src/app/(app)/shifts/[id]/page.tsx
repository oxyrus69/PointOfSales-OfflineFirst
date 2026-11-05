import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Badge, KeyValue, Money, StatusBadge } from "@/components/ui";
import { CashMovementForm, CloseShiftForm } from "@/components/shift-forms";
import { requirePageUser } from "@/server/rbac";
import { computeShiftTotals, getShiftById, listCashMovements } from "@/server/services/shiftEngine";
import { getStoreSettings } from "@/server/services/settings";
import { formatDateTime, toNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Rincian Shift" };
export const dynamic = "force-dynamic";

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();
  const shift = await getShiftById(id);
  if (!shift) notFound();

  const isOwnerCashier = shift.cashierId === user.id;
  const canManage = user.role === "SUPER_ADMIN" || user.role === "STORE_MANAGER";
  if (!isOwnerCashier && !canManage) {
    notFound();
  }

  const [totals, movements, settings] = await Promise.all([
    computeShiftTotals(id),
    listCashMovements(id),
    getStoreSettings(),
  ]);

  const expected = shift.status === "OPEN" ? null : toNumber(shift.expectedCashSystem);
  const variance = shift.status === "OPEN" ? null : toNumber(shift.cashVariance);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rincian shift"
        title={shift.shiftNumber}
        description={`${formatDateTime(shift.openedAt)} · terminal ${shift.terminalId}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge value={shift.status} />
            <Link href={`/reports/shift/${shift.id}`} className="btn btn-ghost">
              Z Report
            </Link>
            <Link href="/shifts" className="btn btn-ghost">
              Kembali
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Panel title="Arus kas shift" description="Dihitung dari transaksi dan pergerakan laci, bukan dari input manual">
            <KeyValue
              items={[
                { label: "Modal awal", value: <Money value={shift.openingCash} /> },
                { label: "Penjualan tunai", value: <Money value={totals.cashSales} /> },
                { label: "Penjualan non-tunai", value: <Money value={totals.nonCashSales} /> },
                { label: "Kas masuk lain", value: <Money value={totals.cashInMisc} /> },
                { label: "Kas keluar operasional", value: <Money value={totals.cashOutExpense} /> },
                { label: "Setor ke brankas", value: <Money value={totals.cashDropSafe} /> },
                { label: "Transaksi selesai", value: totals.transactionCount },
                { label: "Nilai void", value: <Money value={totals.voidAmount} /> },
                {
                  label: "Kas seharusnya",
                  value: shift.status === "OPEN" ? "tersembunyi (blind)" : <Money value={expected} />,
                  strong: true,
                },
                {
                  label: "Uang fisik dihitung",
                  value: shift.status === "OPEN" ? "—" : <Money value={shift.actualCashCounted} />,
                },
                {
                  label: "Selisih",
                  value:
                    shift.status === "OPEN" ? (
                      "belum dihitung"
                    ) : (
                      <span className={variance && variance < 0 ? "text-alert-700" : undefined}>
                        <Money value={variance} />
                      </span>
                    ),
                  strong: true,
                },
              ]}
            />
            {shift.closingNotes ? (
              <p className="mt-3 border-t border-ink-100 pt-3 text-[0.8125rem] text-ink-600">
                Catatan kasir: {shift.closingNotes}
              </p>
            ) : null}
          </Panel>

          <Panel title="Pergerakan laci" description="Setiap rupiah yang keluar-masuk selain penjualan" flush>
            {movements.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-ink-500">Hanya modal awal yang tercatat pada shift ini.</p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Jenis</th>
                      <th>Alasan</th>
                      <th className="text-right">Nominal</th>
                      <th>Otorisasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id}>
                        <td className="num text-[0.8125rem]">{formatDateTime(movement.createdAt)}</td>
                        <td>
                          <Badge
                            tone={
                              movement.movementType === "CASH_OUT_EXPENSE"
                                ? "alert"
                                : movement.movementType === "CASH_IN_MISC"
                                  ? "grove"
                                  : "neutral"
                            }
                          >
                            {movement.movementType.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="max-w-[24ch] text-[0.8125rem]">{movement.reason}</td>
                        <td className="num text-right text-[0.8125rem]">{formatIdrSafe(movement.amount)}</td>
                        <td className="text-[0.75rem] text-ink-500">
                          {movement.authorizedBy ? "PIN supervisor" : movement.actorName ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          {shift.status === "OPEN" && isOwnerCashier ? (
            <Panel title="Tutup shift (blind drop)" description="Hitung uang fisik dulu, sistem baru membandingkan">
              <CloseShiftForm shiftId={shift.id} tolerance={settings.varianceToleranceIdr} />
            </Panel>
          ) : null}

          {shift.status === "OPEN" ? (
            <Panel title="Catat kas masuk / keluar" description={`Ambang PIN Supervisor: ${formatIdrSafe(settings.cashOutPinThreshold)}`}>
              <CashMovementForm shiftId={shift.id} pinThreshold={settings.cashOutPinThreshold} />
            </Panel>
          ) : null}

          <Panel title="Konteks kebijakan" description="Berlaku untuk semua terminal">
            <ul className="space-y-2 text-[0.8125rem] text-ink-700">
              <li>
                Toleransi selisih: <span className="num">{formatIdrSafe(settings.varianceToleranceIdr)}</span>
              </li>
              <li>
                Ambang PIN kas keluar: <span className="num">{formatIdrSafe(settings.cashOutPinThreshold)}</span>
              </li>
              <li>
                Batas diskon kasir: <span className="num">{settings.cashierDiscountLimitPct}%</span> dari subtotal
              </li>
              <li>
                PPN: <span className="num">{settings.taxRatePct}%</span>{" "}
                {settings.priceIncludesTax ? "(harga termasuk pajak)" : "(ditambahkan)"}
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function formatIdrSafe(value: unknown): string {
  return `Rp ${toNumber(value).toLocaleString("id-ID")}`;
}
