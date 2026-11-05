import type { Metadata } from "next";
import { TransactionsWorkspace } from "@/components/transactions-workspace";
import { requirePageRole } from "@/server/rbac";
import { listOrders } from "@/server/services/salesEngine";
import { sanitizeEnum, sanitizeText } from "@/lib/params";
import { toNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Transaksi" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
  const params = await searchParams;
  const search = sanitizeText(params.q, 60);
  const status = sanitizeEnum(params.status, ["COMPLETED", "VOIDED", "PARTIALLY_REFUNDED", "REFUNDED"] as const);

  const orders = await listOrders({
    search,
    status,
    days: user.role === "CASHIER" ? 3 : 60,
    limit: 200,
  });

  const visible = user.role === "CASHIER" ? orders.filter((order) => order.cashierId === user.id) : orders;

  return (
    <TransactionsWorkspace
      search={search}
      status={status ?? ""}
      orders={visible.map((order) => ({
        id: order.id,
        receiptNumber: order.receiptNumber,
        createdAt: order.createdAt.toISOString(),
        status: order.status,
        syncMode: order.syncMode,
        paymentMethod: order.paymentMethod,
        grandTotal: toNumber(order.grandTotal),
        subtotal: toNumber(order.subtotal),
        taxAmount: toNumber(order.taxAmount),
        totalCogs: toNumber(order.totalCogs),
        cashierName: order.cashierName,
        shiftNumber: order.shiftNumber,
        voidReason: order.voidReason,
      }))}
    />
  );
}
