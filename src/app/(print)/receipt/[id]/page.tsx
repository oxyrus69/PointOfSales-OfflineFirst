import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintSheet } from "@/components/print-toolbar";
import { getOrderDetail, findOrderByReceipt } from "@/server/services/salesEngine";
import { getStoreSettings } from "@/server/services/settings";
import { verifyReceiptSignature } from "@/server/crypto";
import { formatDateTime, toNumber } from "@/lib/format";
import { receiptVerificationCode } from "@/lib/hmac";

export const metadata: Metadata = { title: "Struk" };
export const dynamic = "force-dynamic";

function rupiah(value: unknown): string {
  return toNumber(value).toLocaleString("id-ID");
}

function line(label: string, value: string, strong = false): string {
  const dots = ".".repeat(Math.max(1, 40 - label.length - value.length));
  return `${label} ${dots}${strong ? " " : " "}${value}`;
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Accept either an order UUID or the receipt number so a scanned copy works.
  const detail = /^[0-9a-fA-F-]{36}$/.test(id) ? await getOrderDetail(id) : await findOrderByReceipt(id);
  if (!detail) notFound();

  const [{ order, items, cashierName }, settings] = await Promise.all([Promise.resolve(detail), getStoreSettings()]);

  const signaturValid = await verifyReceiptSignature({
    orderId: order.id,
    receiptNumber: order.receiptNumber,
    createdAt: order.createdAt.toISOString(),
    grandTotal: toNumber(order.grandTotal),
    signature: order.receiptSignature,
  });

  const gross = toNumber(order.subtotal);
  const discount =
    toNumber(order.tierDiscountTotal) +
    toNumber(order.memberDiscountAmount) +
    toNumber(order.promoDiscountAmount) +
    toNumber(order.manualDiscountAmount);

  return (
    <PrintSheet defaultWidth="80mm">
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.02em" }}>{settings.storeName.toUpperCase()}</p>
        <p>{settings.storeAddress}</p>
        <p>Telp {settings.storePhone}</p>
      </div>

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      <p>{line("No", order.receiptNumber)}</p>
      <p>{line("Waktu", formatDateTime(order.createdAt))}</p>
      <p>{line("Kasir", cashierName ?? "-")}</p>
      <p>{line("Bayar", order.paymentMethod.replace(/_/g, " "))}</p>
      {order.paymentReference ? <p>{line("Ref", order.paymentReference)}</p> : null}

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      {items.map((item) => (
        <div key={item.id} style={{ marginBottom: "3px" }}>
          <p>{item.productNameSnapshot}</p>
          <p style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              {item.qty} x {rupiah(item.appliedUnitPrice)}
              {item.tierLabelApplied ? ` · ${item.tierLabelApplied}` : ""}
            </span>
            <span style={{ fontWeight: 600 }}>{rupiah(item.lineSubtotal)}</span>
          </p>
        </div>
      ))}

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      <p>{line("Subtotal", rupiah(gross))}</p>
      {discount > 0 ? <p>{line("Diskon", `-${rupiah(discount)}`)}</p> : null}
      {toNumber(order.taxAmount) > 0 ? <p>{line(`PPN ${settings.taxRatePct}%`, rupiah(order.taxAmount))}</p> : null}
      {toNumber(order.roundingAdjustment) !== 0 ? (
        <p>{line("Pembulatan", rupiah(order.roundingAdjustment))}</p>
      ) : null}
      <p style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "13px" }}>
        <span>TOTAL</span>
        <span>Rp {rupiah(order.grandTotal)}</span>
      </p>
      {toNumber(order.cashReceived) > 0 ? <p>{line("Tunai", rupiah(order.cashReceived))}</p> : null}
      {toNumber(order.changeGiven) > 0 ? <p>{line("Kembali", rupiah(order.changeGiven))}</p> : null}

      {order.status === "VOIDED" ? (
        <>
          <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
          <p style={{ textAlign: "center", fontWeight: 700 }}>*** STRUK VOID ***</p>
          <p style={{ textAlign: "center" }}>{order.voidReason}</p>
        </>
      ) : null}

      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

      <p style={{ textAlign: "center", fontSize: "10px" }}>
        Kode verifikasi: {order.receiptSignature ? receiptVerificationCode(order.receiptSignature) : "-"}
        {signaturValid ? "" : " (tanda tangan tidak cocok)"}
      </p>
      <p style={{ textAlign: "center", fontSize: "10px" }}>Simpan struk ini sebagai bukti pembelian.</p>
      <p style={{ textAlign: "center", fontSize: "10px", marginTop: "4px" }}>Terima kasih sudah berbelanja.</p>

      <div className="no-print" style={{ marginTop: "12px", borderTop: "1px solid #ddd", paddingTop: "6px", fontSize: "10px", color: "#555" }}>
        <p>
          ID internal: <span style={{ fontFamily: "monospace" }}>{order.id}</span>
        </p>
        <p>
          Sumber: {order.syncMode === "SYNCED_FROM_OFFLINE" ? "tersinkron dari mode offline" : "online"} · HMAC{" "}
          {signaturValid ? "valid" : "gagal verifikasi"}
        </p>
      </div>
    </PrintSheet>
  );
}
