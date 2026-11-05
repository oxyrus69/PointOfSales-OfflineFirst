import type { Metadata } from "next";
import { PageHeader, Panel, Stat, Badge, Money, EmptyState } from "@/components/ui";
import { requirePageRole } from "@/server/rbac";
import { listCustomers, topCustomers } from "@/server/services/customers";
import { formatDateShort, formatIdr } from "@/lib/format";

export const metadata: Metadata = { title: "Pelanggan" };
export const dynamic = "force-dynamic";

const TIER_TONE: Record<string, "neutral" | "signal" | "accent" | "caution"> = {
  REGULAR: "neutral",
  SILVER: "signal",
  GOLD: "caution",
  VIP: "accent",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePageRole("SUPER_ADMIN", "STORE_MANAGER", "CASHIER");
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.slice(0, 60) : "";
  const [customers, top] = await Promise.all([listCustomers({ search, limit: 300 }), topCustomers(6)]);

  const totalSpent = customers.reduce((sum, customer) => sum + customer.totalSpent, 0);
  const points = customers.reduce((sum, customer) => sum + customer.pointsBalance, 0);
  const tierCount = customers.reduce<Record<string, number>>((acc, customer) => {
    acc[customer.tier] = (acc[customer.tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Member & pelanggan"
        title="Basis pelanggan"
        description="Diskon member melekat pada tier dan dihitung sebelum promo. Poin bertambah Rp 1 per Rp 10.000 belanja neto."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Member terdaftar" value={customers.length} hint={`${tierCount.VIP ?? 0} VIP · ${tierCount.GOLD ?? 0} GOLD`} />
        <Stat label="Total belanja" value={<Money value={totalSpent} />} hint="Akumulasi belanja neto seluruh member" tone="grove" />
        <Stat label="Poin beredar" value={points.toLocaleString("id-ID")} hint="Kewajiban poin yang belum ditukar" />
        <Stat label="Member aktif 30 hari" value={customers.filter((customer) => customer.totalSpent > 0).length} hint="Pernah bertransaksi" />
      </div>

      <form className="panel flex flex-wrap items-end gap-2 px-4 py-3" action="/customers">
        <label className="min-w-[14rem] flex-1">
          <span className="label-xs">Cari nama, kode member, atau telepon</span>
          <input name="q" defaultValue={search} className="field mt-1.5" placeholder="Budi / MBR-00001 / 0812…" />
        </label>
        <button type="submit" className="btn btn-primary">
          Cari
        </button>
      </form>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Daftar member" description={`${customers.length} baris`} flush>
          {customers.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState title="Belum ada member" description="Member dibuat dari halaman ini atau saat kasir mendaftarkan pelanggan." />
            </div>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama</th>
                    <th>Telepon</th>
                    <th>Tier</th>
                    <th className="text-right">Diskon</th>
                    <th className="text-right">Poin</th>
                    <th className="text-right">Total belanja</th>
                    <th>Terdaftar</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="num text-[0.8125rem] font-medium">{customer.memberCode}</td>
                      <td className="text-[0.8125rem]">{customer.name}</td>
                      <td className="num text-[0.75rem] text-ink-600">{customer.phone ?? "—"}</td>
                      <td>
                        <Badge tone={TIER_TONE[customer.tier] ?? "neutral"}>{customer.tier}</Badge>
                      </td>
                      <td className="num text-right text-[0.8125rem]">{customer.discountPct}%</td>
                      <td className="num text-right text-[0.8125rem]">{customer.pointsBalance}</td>
                      <td className="num text-right text-[0.8125rem]">{formatIdr(customer.totalSpent)}</td>
                      <td className="num text-[0.75rem] text-ink-500">{formatDateShort(customer.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Belanja terbesar" flush>
            <ul className="divide-y divide-ink-100">
              {top.map((customer) => (
                <li key={customer.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-medium">{customer.name}</p>
                    <p className="text-[0.6875rem] text-ink-500">
                      {customer.tier} · {customer.pointsBalance} poin
                    </p>
                  </div>
                  <span className="num shrink-0 text-[0.8125rem]">{formatIdr(customer.totalSpent)}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Aturan tier">
            <ul className="space-y-1.5 text-[0.8125rem]">
              <li className="flex items-center justify-between">
                <span>REGULAR</span> <span className="num">0%</span>
              </li>
              <li className="flex items-center justify-between">
                <span>SILVER</span> <span className="num">2%</span>
              </li>
              <li className="flex items-center justify-between">
                <span>GOLD</span> <span className="num">5%</span>
              </li>
              <li className="flex items-center justify-between">
                <span>VIP</span> <span className="num">8%</span>
              </li>
            </ul>
            <p className="mt-2.5 border-t border-ink-100 pt-2.5 text-[0.75rem] leading-relaxed text-ink-500">
              Diskon tier bisa diubah per pelanggan di database, tetapi nilai default mengikuti tabel di atas.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
