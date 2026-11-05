import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Badge, KeyValue, Money, StatusBadge } from "@/components/ui";
import { OrderActions } from "@/components/order-actions";
import { requirePageRole } from "@/server/rbac";
import { getOrderDetail } from "@/server/services/salesEngine";
import { verifyReceiptSignature } from "@/server/crypto";
import { formatDateTime, formatIdr, toNumber } from "@/lib/format";
import { receiptVerificationCode } from "@/lib/hmac";

export const metadata: Metadata = { title: "Detail Transaksi" };
export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  if (user.role === "CASHIER" && detail.order.cashierId !== user.id) notFound();

  const { order, items, cashierName } = detail;
  const signatureValid = await verifyReceiptSignature({
    orderId: order.id,
    receiptNumber: order.receiptNumber,
    createdAt: order.createdAt.toISOString(),
    grandTotal: toNumber(order.grandTotal),
    signature: order.receiptSignature,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Struk penjualan"
        title={order.receiptNumber}
        description={`${formatDateTime(order.createdAt)} · kasir ${cashierName ?? "-"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={order.status} />
            <Link href={`/receipt/${order.id}`} target="_blank" className="btn btn-ghost">
              Cetak struk
            </Link>
            <Link href="/transactions" className="btn btn-ghost">
              Kembali
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-4">
          <Panel title="Item terjual" flush>
            <div className="scroll-thin overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th className="text-right">Harga dasar</th>
                    <th className="text-right">Harga diterapkan</th>
                    <th className="text-center">Qty</th>
                    <th className="text-center">Retur</th>
                    <th className="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="block text-[0.8125rem] font-medium">{item.productNameSnapshot}</span>
                        <span className="num block text-[0.6875rem] text-ink-500">{item.skuSnapshot}</span>
                        {item.tierLabelApplied ? <Badge tone="accent">{item.tierLabelApplied}</Badge> : null}
                      </td>
                      <td className="num text-right text-[0.8125rem] text-ink-500">{formatIdr(item.baseUnitPrice)}</td>
                      <td className="num text-right text-[0.8125rem]">{formatIdr(item.appliedUnitPrice)}</td>
                      <td className="num text-center text-[0.8125rem]">{item.qty}</td>
                      <td className="num text-center text-[0.8125rem]">{item.refundedQty || "—"}</td>
                      <td className="num text-right text-[0.8125rem] font-medium">{formatIdr(item.lineSubtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Void & retur" description="Aksi ini memerlukan PIN Supervisor dan dicatat di jejak audit">
            <OrderActions
              orderId={order.id}
              status={order.status}
              canAct={user.role === "SUPER_ADMIN" || user.role === "STORE_MANAGER"}
              items={items.map((item) => ({
                id: item.id,
                productNameSnapshot: item.productNameSnapshot,
                skuSnapshot: item.skuSnapshot,
                qty: item.qty,
                refundedQty: item.refundedQty,
                appliedUnitPrice: item.appliedUnitPrice,
              }))}
            />
            {order.status === "VOIDED" ? (
              <div className="mt-3 rounded-md border border-alert-100 bg-alert-100 px-3.5 py-2.5 text-[0.8125rem] text-alert-700">
                Void oleh supervisor {formatDateTime(order.voidedAt)}. Alasan: {order.voidReason ?? "tidak dicatat"}
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Rincian pembayaran">
            <KeyValue
              items={[
                { label: "Subtotal", value: <Money value={order.subtotal} /> },
                { label: "Hemat grosir", value: <Money value={order.tierDiscountTotal} /> },
                { label: "Diskon member", value: <Money value={order.memberDiscountAmount} /> },
                { label: "Diskon promo", value: <Money value={order.promoDiscountAmount} /> },
                { label: "Diskon manual", value: <Money value={order.manualDiscountAmount} /> },
                { label: "PPN", value: <Money value={order.taxAmount} /> },
                { label: "Pembulatan", value: <Money value={order.roundingAdjustment} /> },
                { label: "Total", value: <Money value={order.grandTotal} />, strong: true },
                { label: "Uang diterima", value: <Money value={order.cashReceived} /> },
                { label: "Kembalian", value: <Money value={order.changeGiven} /> },
                { label: "Metode", value: order.paymentMethod.replace(/_/g, " ") },
                { label: "Referensi", value: order.paymentReference ?? "—" },
                { label: "HPP terjual", value: <Money value={order.totalCogs} /> },
                {
                  label: "Laba kotor",
                  value: <Money value={toNumber(order.grandTotal) - toNumber(order.taxAmount) - toNumber(order.totalCogs)} />,
                  strong: true,
                },
              ]}
            />
          </Panel>

          <Panel title="Integritas struk">
            <div className="space-y-2 text-[0.8125rem]">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Tanda tangan HMAC</span>
                <Badge tone={signatureValid ? "grove" : "alert"}>{signatureValid ? "valid" : "tidak cocok"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Kode verifikasi</span>
                <span className="num">{order.receiptSignature ? receiptVerificationCode(order.receiptSignature) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Sumber</span>
                <Badge tone={order.syncMode === "SYNCED_FROM_OFFLINE" ? "signal" : "neutral"}>
                  {order.syncMode.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Client request ID</span>
                <span className="num max-w-[14ch] truncate text-[0.75rem]">{order.clientRequestId}</span>
              </div>
            </div>
            <p className="mt-2.5 border-t border-ink-100 pt-2.5 text-[0.75rem] leading-relaxed text-ink-500">
              Tanda tangan dihitung dari id, nomor struk, waktu, dan total. Bila salah satu angka diubah langsung di
              database, verifikasi ini gagal.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
