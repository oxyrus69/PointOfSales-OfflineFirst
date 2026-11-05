/** GET /api/export/inventory — CSV stok, HPP, dan kartu stok terakhir. */
import { NextResponse } from "next/server";
import { requireRole } from "@/server/rbac";
import { listCatalog } from "@/server/services/products";
import { csvResponse, timestampedFilename, toCsv } from "@/server/services/csv";
import { fail } from "@/server/services/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("SUPER_ADMIN", "STORE_MANAGER", "WAREHOUSE_STAFF");
    const products = await listCatalog({ includeInactive: true, limit: 5000 });

    const csv = toCsv(
      [
        "SKU",
        "Barcode",
        "Nama",
        "Kategori",
        "Satuan",
        "HPP",
        "Harga Eceran",
        "Margin %",
        "Margin Minimum %",
        "Stok",
        "Titik Pesan Ulang",
        "Jumlah Pesan Ulang",
        "Kena PPN",
        "Aktif",
        "Nilai Stok HPP",
        "Jumlah Tier Grosir",
      ],
      products.map((product) => [
        product.sku,
        product.barcode ?? "",
        product.name,
        product.categoryName ?? "",
        product.unit,
        product.costPrice,
        product.retailPrice,
        product.retailPrice > 0
          ? Math.round(((product.retailPrice - product.costPrice) / product.retailPrice) * 10000) / 100
          : 0,
        product.minMarginPct,
        product.stockOnHand,
        product.reorderPoint,
        product.reorderQty,
        product.isTaxable ? "YA" : "TIDAK",
        product.isActive ? "YA" : "TIDAK",
        product.stockOnHand * product.costPrice,
        product.tiers.length,
      ]),
    );

    return csvResponse(csv, timestampedFilename("katalis-inventaris"));
  } catch (error) {
    const failure = fail(error);
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status ?? 500 });
  }
}
