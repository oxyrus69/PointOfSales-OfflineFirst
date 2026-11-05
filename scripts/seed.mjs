/**
 * seed.mjs — idempotent demo data for Katalis POS.
 *
 * Deterministic UUIDs (RFC 4122 name-based, sha1 over stable labels) mean
 * re-running the script leaves the dataset intact instead of duplicating rows.
 * Password/PIN hashes use stable salts for the same reason.
 *
 * Coverage required by the spec:
 *  - 5 accounts (owner/manager/2 cashiers/warehouse), password katalis123
 *  - 16 products in 4 categories, EAN-13 barcodes, wholesale price tiers
 *  - restock-urgent, dead-stock and margin-erosion products for the DSS
 *  - 5 members across all tiers, 3 active promos
 *  - 3 shifts: 1 OPEN (kasir1), 1 CLOSED_MATCHED, 1 CLOSED_WITH_VARIANCE (-75k)
 *  - 12 sales orders: cash/QRIS/split, 1 VOIDED (supervisor-authorized),
 *    1 SYNCED_FROM_OFFLINE, plus 1 unresolved negative-stock sync conflict
 *  - 1 approved stock opname + full stock ledger history
 */
import { createHash } from "node:crypto";
import { connectDatabase } from "./lib/db.mjs";
import {
  DEMO_PASSWORD,
  DEMO_SIGNING_KEY,
  MANAGER_PIN,
  OWNER_PIN,
  calcTotals,
  daysAgo,
  hashSecretStable,
  iso,
  signReceipt,
} from "./lib/seed-helpers.mjs";

process.env.RECEIPT_SIGNING_KEY ??= DEMO_SIGNING_KEY;

const NS = "katalis-pos-seed-v1";
function uid(label) {
  const nsBytes = createHash("sha1").update(NS).digest().subarray(0, 16);
  const bytes = createHash("sha1").update(nsBytes).update(label).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const money = (value) => Math.round(value).toFixed(2);

/** Deterministic EAN-13 with a valid checksum digit. */
function ean13(seed) {
  const base = `899${String(seed).padStart(9, "0")}`.slice(0, 12);
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(base[index]) * (index % 2 === 0 ? 1 : 3);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

const PRODUCTS = [
  { key: "santan", sku: "SBK-001", name: "Santan Instan 65ml", cat: "SBK", cost: 3200, retail: 4500, stock: 180, reorder: 40, reorderQty: 120, unit: "PCS", taxable: true, tiers: [[12, 4250, "Karton 12 pcs"]] },
  { key: "gula", sku: "SBK-002", name: "Gula Pasir 1kg", cat: "SBK", cost: 14500, retail: 17500, stock: 90, reorder: 24, reorderQty: 60, unit: "PCS", taxable: true, tiers: [[6, 17000, "Grosir Setengah Lusin"], [12, 16800, "Harga Karton"]] },
  { key: "beras", sku: "SBK-003", name: "Beras Premium 5kg", cat: "SBK", cost: 62000, retail: 71500, stock: 42, reorder: 10, reorderQty: 30, unit: "SAK", taxable: true, tiers: [[6, 70500, "Grosir 6 Sak"]] },
  { key: "minyak", sku: "SBK-004", name: "Minyak Goreng 2L", cat: "SBK", cost: 33500, retail: 38500, stock: 4, reorder: 12, reorderQty: 48, unit: "PCH", taxable: true, tiers: [[6, 37800, "Grosir 6 Pouch"]] },
  { key: "tehkotak", sku: "MIN-001", name: "Teh Kotak 300ml", cat: "MIN", cost: 3850, retail: 5000, stock: 240, reorder: 48, reorderQty: 120, unit: "PCS", taxable: true, tiers: [[12, 4800, "Karton 12 pcs"]] },
  { key: "air600", sku: "MIN-002", name: "Air Mineral 600ml", cat: "MIN", cost: 2700, retail: 4000, stock: 340, reorder: 60, reorderQty: 180, unit: "PCS", taxable: true, tiers: [[12, 3800, "Karton 12 pcs"], [24, 3700, "Grosir 2 Karton"]] },
  { key: "kopisachet", sku: "MIN-003", name: "Kopi Sachet Susu", cat: "MIN", cost: 1450, retail: 2000, stock: 120, reorder: 36, reorderQty: 240, unit: "SCH", taxable: true, tiers: [[24, 1900, "Grosir 2 Lusin"]] },
  { key: "susuUHT", sku: "MIN-004", name: "Susu UHT Cokelat 1L", cat: "MIN", cost: 16900, retail: 21000, stock: 54, reorder: 12, reorderQty: 36, unit: "PCS", taxable: true, tiers: [[12, 20500, "Karton 12"]] },
  { key: "pulpen", sku: "ATK-001", name: "Pulpen Gel Hitam", cat: "ATK", cost: 2100, retail: 3500, stock: 130, reorder: 24, reorderQty: 96, unit: "PCS", taxable: false, tiers: [[12, 3200, "Grosir 1 Lusin"]] },
  { key: "bukutulis", sku: "ATK-002", name: "Buku Tulis 38 Lbr", cat: "ATK", cost: 3900, retail: 5500, stock: 88, reorder: 24, reorderQty: 72, unit: "PCS", taxable: false, tiers: [[12, 5200, "Grosir 1 Lusin"]] },
  { key: "foldersusp", sku: "ATK-003", name: "Folder Suspend Plastik", cat: "ATK", cost: 5200, retail: 7500, stock: 3, reorder: 12, reorderQty: 48, unit: "PCS", taxable: false, tiers: [] },
  { key: "pensil2b", sku: "ATK-004", name: "Pensil 2B Kayu", cat: "ATK", cost: 1800, retail: 3000, stock: 200, reorder: 36, reorderQty: 144, unit: "PCS", taxable: false, tiers: [[24, 2800, "Grosir 2 Lusin"]] },
  { key: "sabunpingan", sku: "RHT-001", name: "Sabun Cuci Piring 780ml", cat: "RHT", cost: 15800, retail: 16500, stock: 66, reorder: 12, reorderQty: 36, unit: "BOT", taxable: true, tiers: [[6, 16000, "Grosir 6 Botol"]], marginFloor: 30 },  { key: "deterjen", sku: "RHT-002", name: "Deterjen Bubuk 800g", cat: "RHT", cost: 17200, retail: 21500, stock: 5, reorder: 12, reorderQty: 36, unit: "PCS", taxable: true, tiers: [[6, 21000, "Grosir 6 pcs"]] },
  { key: "sponsdead", sku: "RHT-003", name: "Spons Cuci Premium", cat: "RHT", cost: 16500, retail: 22000, stock: 84, reorder: 12, reorderQty: 24, unit: "PCS", taxable: true, tiers: [] },
  { key: "lampuded", sku: "RHT-004", name: "Lampu LED 12W", cat: "RHT", cost: 21500, retail: 29500, stock: 52, reorder: 10, reorderQty: 24, unit: "PCS", taxable: true, tiers: [] },
];

async function main() {
  const db = await connectDatabase();
  console.log(`[db:seed] target: ${db.label}`);
  const q = async (text, params = []) => {
    try {
      return await db.query(text, params);
    } catch (error) {
      console.error("[db:seed] query gagal:", text.trim().split("\n")[0].slice(0, 160));
      throw error;
    }
  };




  /* ---------------------------------------------------------- sale helper */
  async function insertSale(opts) {
    // opts: { key, shiftId, cashierId, customer?, promo?, memberPct, manual,
    //         method, cash, change, lines:[{key,qty,unitPrice?,cogs}], sync,
    //         status?, at, offlineAt?, voided?, ref? }
    const orderId = uid(`order-${opts.key}`);
    const receiptNumber = opts.receiptNumber ?? `INV-YYYYMMDD-${String(1 + (hashInt(opts.key) % 8999)).padStart(4, "0")}`.replace("YYYYMMDD", stamp(opts.at));
    const lines = opts.lines.map((line) => {
      const product = PRODUCTS.find((row) => row.key === line.key);
      const tiers = (product.tiers ?? []).map(([minQty, price, label]) => ({ minQty, tierUnitPrice: price, label }));
      return {
        productId: P[line.key],
        sku: product.sku,
        name: product.name,
        qty: line.qty,
        baseUnitPrice: product.retail,
        costPrice: product.cost,
        isTaxable: product.taxable,
        tiers,
        overrideUnitPrice: line.unitPrice ?? null,
      };
    });
    const totals = calcTotals({
      lines,
      memberDiscountPct: opts.memberPct ?? 0,
      promo: opts.promo ?? null,
      manualDiscount: opts.manual ?? 0,
      paymentMethod: opts.method,
    });
    if (totals.grandTotal !== (opts.expectTotal ?? totals.grandTotal)) {
      // keep server truth; expectation is only an e2e cross-check hook
    }
    let netTotal = totals.grandTotal;
    if (opts.overrideNet != null) netTotal = opts.overrideNet;

    // Cash tendered must always cover the total; derive rather than hand-write
    // so a seeded receipt can never show a short payment.
    const cashTendered =
      opts.method === "CASH" ? Math.max(netTotal, opts.cash ?? netTotal) : 0;
    const changeGiven = opts.method === "CASH" ? Math.max(0, cashTendered - netTotal) : 0;

    const payments =
      opts.method === "SPLIT_PAYMENT"
        ? [
            { method: "CASH", amount: Math.round(netTotal / 2), reference: null },
            { method: "QRIS", amount: netTotal - Math.round(netTotal / 2), reference: opts.ref ?? null },
          ]
        : [{ method: opts.method, amount: netTotal, reference: opts.method === "CASH" ? null : (opts.ref ?? null) }];

    await q(
      `insert into sales_orders (id, receipt_number, client_request_id, shift_id, cashier_id, customer_id, promo_id,
           status, sync_mode, created_offline_at, synced_at, subtotal, tier_discount_total, member_discount_amount,
           promo_discount_amount, manual_discount_amount, tax_amount, rounding_adjustment, grand_total, total_cogs,
           payment_method, cash_received, change_given, payment_reference, receipt_signature, voided_at,
           voided_by_supervisor, void_reason, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         on conflict do nothing`,
      [
        orderId,
        receiptNumber,
        `seed-${opts.key}`,
        opts.shiftId,
        opts.cashierId,
        opts.customer ? C[opts.customer] : null,
        opts.promoId ?? null,
        opts.voided ? "VOIDED" : "COMPLETED",
        opts.sync ? "SYNCED_FROM_OFFLINE" : "DIRECT_ONLINE",
        opts.offlineAt ? iso(opts.offlineAt) : null,
        opts.sync ? iso(opts.at) : null,
        money(totals.subtotal),
        money(totals.tierDiscountTotal),
        money(totals.memberDiscountAmount),
        money(totals.promoDiscountAmount),
        money(totals.manualDiscountAmount),
        money(totals.taxAmount),
        money(totals.roundingAdjustment),
        money(netTotal),
        money(totals.totalCogs),
        opts.method,
        money(opts.method === "CASH" ? cashTendered : 0),
        money(changeGiven),
        opts.method === "CASH" ? null : (opts.ref ?? null),
        signReceipt({ orderId, receiptNumber, createdAt: iso(opts.at), grandTotal: netTotal }),
        opts.voided ? iso(new Date(opts.at.getTime() + 25 * 60_000)) : null,
        opts.voided ? user.manager : null,
        opts.voided ? (opts.voidReason ?? "Salah input kasir, disetujui supervisor") : null,
        iso(opts.at),
      ],
    );

    for (const line of totals.lines) {
      const override = lines.find((raw) => raw.productId === line.productId)?.overrideUnitPrice;
      const unitPrice = override ?? line.applied;
      await q(
        `insert into sales_order_items (id, order_id, product_id, product_name_snapshot, sku_snapshot, qty,
             base_unit_price, applied_unit_price, tier_label_applied, unit_cogs_snapshot, line_subtotal)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict do nothing`,
        [
          uid(`item-${opts.key}-${line.sku}`),
          orderId,
          line.productId,
          line.name,
          line.sku,
          line.qty,
          money(line.baseUnitPrice),
          money(unitPrice),
          override ? null : line.tierLabel,
          money(line.unitCogs),
          money(unitPrice * line.qty),
        ],
      );
    }

    for (const payment of payments) {
      await q(
        `insert into sales_payments (id, order_id, method, amount, reference_no) values ($1,$2,$3,$4,$5)
         on conflict (id) do nothing`,
        [uid(`pay-${opts.key}-${payment.method}`), orderId, payment.method, money(payment.amount), payment.reference],
      );
    }
    return { orderId, receiptNumber, totals };
  }

  // Stable small int from a label so receipt numbering is deterministic.
  function hashInt(label) {
    let value = 0;
    for (const ch of label) value = (value * 31 + ch.charCodeAt(0)) % 100000;
    return value;
  }
  function stamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }
  let receiptSeq = 1001;
  function nextReceipt(date) {
    return `INV-${stamp(date)}-${String(receiptSeq++).padStart(4, "0")}`;
  }

  function addLedger(entry) {
    return q(
      `insert into stock_ledgers (id, product_id, movement_type, reference_id, qty_change, qty_before, qty_after,
           unit_cost_at_movement, actor_id, notes, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do nothing`,
      [
        // Stable id → re-running the seed cannot duplicate ledger history.
        uid(`ledger-${entry.ref}-${entry.key}-${entry.type}-${entry.delta}`),
        P[entry.key],
        entry.type,
        entry.ref,
        entry.delta,
        entry.before,
        entry.after,
        money(entry.unitCost),
        entry.actor ?? null,
        entry.notes ?? null,
        iso(entry.at),
      ],
    );
  }


  /* ---------------------------------------------------------------- users */
  const accounts = [
    ["owner", "owner@katalispos.id", "Hendra Wijaya", "SUPER_ADMIN", OWNER_PIN],
    ["manager", "manager@katalispos.id", "Ratna Sari", "STORE_MANAGER", MANAGER_PIN],
    ["kasir1", "kasir1@katalispos.id", "Dimas Pratama", "CASHIER", null],
    ["kasir2", "kasir2@katalispos.id", "Putri Lestari", "CASHIER", null],
    ["gudang", "gudang@katalispos.id", "Agus Santoso", "WAREHOUSE_STAFF", null],
  ];
  for (const [key, email, name, role, pin] of accounts) {
    await q(
      `insert into profiles (id, email, full_name, role, password_hash, supervisor_pin_hash)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (email) do update set full_name = excluded.full_name, role = excluded.role`,
      [uid(`profile-${key}`), email, name, role, hashSecretStable(DEMO_PASSWORD, `pwd:${email}`), pin ? hashSecretStable(pin, `pin:${email}`) : null],
    );
  }
  const user = Object.fromEntries(accounts.map(([key]) => [key, uid(`profile-${key}`)]));
  console.log("[db:seed] 5 akun demo siap");

  /* ------------------------------------------------------------ categories */
  const categoryList = [
    ["SBK", "Sembako & Bahan Pokok"],
    ["MIN", "Minuman & Kemasan"],
    ["ATK", "Alat Tulis & Kertas"],
    ["RHT", "Kebutuhan Rumah Tangga"],
  ];
  for (const [code, name] of categoryList) {
    await q(
      `insert into categories (id, code, name) values ($1,$2,$3)
       on conflict (code) do update set name = excluded.name`,
      [uid(`cat-${code}`), code, name],
    );
  }
  const cat = Object.fromEntries(categoryList.map(([code]) => [code, uid(`cat-${code}`)]));

  /* -------------------------------------------------------------- products */
  for (const row of PRODUCTS) {
    const id = uid(`product-${row.key}`);
    await q(
      `insert into products (id, sku, barcode, name, category_id, unit, cost_price, retail_price,
                             min_margin_pct, stock_on_hand, reorder_point, reorder_qty, is_taxable, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       on conflict (sku) do update set
         name = excluded.name, barcode = excluded.barcode, category_id = excluded.category_id,
         unit = excluded.unit, cost_price = excluded.cost_price, retail_price = excluded.retail_price,
         min_margin_pct = excluded.min_margin_pct, reorder_point = excluded.reorder_point,
         reorder_qty = excluded.reorder_qty, is_taxable = excluded.is_taxable`,
      [
        id,
        row.sku,
        ean13(PRODUCTS.indexOf(row) + 101),
        row.name,
        cat[row.cat],
        row.unit,
        money(row.cost),
        money(row.retail),
        money(row.marginFloor ?? 10),
        row.stock,
        row.reorder,
        row.reorderQty,
        row.taxable,
      ],
    );
    await q(`delete from product_price_tiers where product_id = $1`, [id]);
    for (const [minQty, price, label] of row.tiers ?? []) {
      await q(
        `insert into product_price_tiers (id, product_id, min_qty, tier_unit_price, label)
         values ($1,$2,$3,$4,$5)
         on conflict (product_id, min_qty) do update set tier_unit_price = excluded.tier_unit_price, label = excluded.label`,
        [uid(`tier-${row.key}-${minQty}`), id, minQty, money(price), label],
      );
    }
  }
  const P = Object.fromEntries(PRODUCTS.map((row) => [row.key, uid(`product-${row.key}`)]));
  console.log(`[db:seed] ${PRODUCTS.length} produk + tier harga grosir siap`);

  /* -------------------------------------------------------------- customers */
  const members = [
    ["MBR-00001", "Budi Santoso", "REGULAR", 0, "081200010001"],
    ["MBR-00002", "Siti Rahayu", "SILVER", 2, "081200010002"],
    ["MBR-00003", "Agus Wibowo", "GOLD", 5, "081200010003"],
    ["MBR-00004", "Dewi Lestari", "VIP", 8, "081200010004"],
    ["MBR-00005", "Rudi Hartono", "REGULAR", 0, "081200010005"],
  ];
  for (const [code, name, tier, discount, phone] of members) {
    await q(
      `insert into customers (id, member_code, name, phone, tier, discount_pct)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (member_code) do update set name = excluded.name, tier = excluded.tier, discount_pct = excluded.discount_pct`,
      [uid(`customer-${code}`), code, name, phone, tier, money(discount)],
    );
  }
  const C = Object.fromEntries(members.map(([code]) => [code, uid(`customer-${code}`)]));
  console.log("[db:seed] 5 member pelanggan siap");

  /* ----------------------------------------------------------------- promos */
  const promoRows = [
    ["HEMAT10", "Diskon 10% belanja di atas 100rb", "PERCENTAGE", 10, 100000, 20000],
    ["GROSIR5K", "Potongan Rp 5.000 grosir", "FIXED_AMOUNT", 5000, 150000, 0],
    ["MEMBER15", "Member day 15% (cap 50rb)", "PERCENTAGE", 15, 200000, 50000],
  ];
  for (const [code, name, type, value, minSubtotal, cap] of promoRows) {
    await q(
      `insert into promos (id, code, name, discount_type, discount_value, min_subtotal, max_discount_cap, valid_from, valid_until, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       on conflict (code) do update set name = excluded.name, discount_type = excluded.discount_type,
         discount_value = excluded.discount_value, min_subtotal = excluded.min_subtotal,
         max_discount_cap = excluded.max_discount_cap, valid_until = excluded.valid_until`,
      [
        uid(`promo-${code}`),
        code,
        name,
        type,
        money(value),
        money(minSubtotal),
        money(cap),
        iso(daysAgo(7, 0, 0)),
        iso(daysAgo(-60, 23, 59)),
      ],
    );
  }
  console.log("[db:seed] 3 promo aktif siap");

  /* --------------------------------------------------------------- settings */
  const appSettingsRows = [
    ["storeName", "Katalis Mart", "store", "Nama Toko"],
    ["storeAddress", "Jl. Merdeka No. 88, Bandung", "store", "Alamat Toko"],
    ["storePhone", "0812-0000-8899", "store", "Telepon Toko"],
    ["taxRatePct", "11", "tax", "Tarif PPN (%)"],
    ["priceIncludesTax", "false", "tax", "Harga sudah termasuk pajak"],
    ["cashRoundingStep", "100", "pos", "Pembulatan tunai (Rp)"],
    ["cashierDiscountLimitPct", "5", "pos", "Batas diskon manual kasir (%)"],
    ["cashOutPinThreshold", "100000", "pos", "Ambang PIN kas keluar (Rp)"],
    ["supervisorVoidEnabled", "true", "pos", "Wajib PIN Supervisor untuk void"],
    ["varianceToleranceIdr", "5000", "shift", "Toleransi selisih kas (Rp)"],
    ["leadTimeDays", "5", "dss", "Lead time supplier (hari)"],
  ];
  for (const [key, value, group, label] of appSettingsRows) {
    await q(
      `insert into app_settings (key, value, "group", label) values ($1,$2,$3,$4)
       on conflict (key) do update set value = excluded.value`,
      [key, value, group, label],
    );
  }
  for (const [code, name, threshold, windowDays, description] of [
    ["RESTOCK_URGENT", "Prediksi kehabisan stok", 0, 30, "Stok <= reorder point atau hari tersisa <= lead time supplier."],
    ["DEAD_STOCK_CAPITAL", "Modal tertahan / dead stock", 1000000, 30, "Terjual < 2 unit/30 hari dengan modal >= Rp 1 juta."],
    ["MARGIN_EROSION", "Erosi margin harga jual", 0, 30, "Margin kotor di bawah min_margin_pct produk."],
    ["CASHIER_RISK_ANOMALY", "Anomali kas & void kasir", -50000, 14, "Akumulasi selisih kas minus atau rasio void tinggi."],
  ]) {
    await q(
      `insert into decision_rules (id, code, name, threshold_value, window_days, description)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do update set name = excluded.name, threshold_value = excluded.threshold_value`,
      [uid(`rule-${code}`), code, name, money(threshold), windowDays, description],
    );
  }
  for (const [code, name, lead] of [["SUP-001", "CV Sumber Pangan Nusantara", 3], ["SUP-002", "PT Aneka Kertas Jaya", 5], ["SUP-003", "PT Rumah Sejahtera Abadi", 7]]) {
    await q(
      `insert into suppliers (id, code, name, lead_time_days) values ($1,$2,$3,$4)
       on conflict (code) do update set name = excluded.name`,
      [uid(`supplier-${code}`), code, name, lead],
    );
  }
  // 3 promo aktif sebagai PromoInput untuk hitung ulang totals order seed
  const PROMO_HEMAT = { code: "HEMAT10", name: "Diskon 10%", discountType: "PERCENTAGE", discountValue: 10, minSubtotal: 100000, maxDiscountCap: 20000 };
  const PROMO_GROSIR = { code: "GROSIR5K", name: "Potongan grosir", discountType: "FIXED_AMOUNT", discountValue: 5000, minSubtotal: 150000, maxDiscountCap: 0 };
  const PROMO_MEMBER = { code: "MEMBER15", name: "Member day", discountType: "PERCENTAGE", discountValue: 15, minSubtotal: 200000, maxDiscountCap: 50000 };

  /* ------------------------------------------------- shifts (3 sesi seed) */
  // 1) Shift CLOSED_MATCHED milik kasir2 (2 hari lalu)
  const shiftMatchedId = uid("shift-matched");
  const tMatchedOpen = daysAgo(2, 8, 0);
  const tMatchedClose = daysAgo(2, 16, 30);
  await q(
    `insert into pos_shifts (id, shift_number, cashier_id, terminal_id, status, opened_at, opening_cash,
         closed_at, expected_cash_system, actual_cash_counted, cash_variance, total_sales_gross, total_discounts,
         total_tax, total_net_sales, total_cash_sales, total_non_cash_sales, total_void_amount)
     values ($1,'SHF-SEED-0001',$2,'KASIR-02','CLOSED_MATCHED',$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,0)
     on conflict (shift_number) do nothing`,
    [
      shiftMatchedId,
      user.kasir2,
      iso(tMatchedOpen),
      money(300000),    // opening_cash
      iso(tMatchedClose),
      money(1425000),   // expected_cash_system
      money(1425000),   // actual_cash_counted (matched)
      money(1580000),   // total_sales_gross
      money(340000),    // total_discounts
      money(47000),     // total_tax
      money(1580000),   // total_net_sales
      money(1240000),   // total_cash_sales
      money(340000),    // total_non_cash_sales
    ],
  );
  await q(
    `insert into cash_drawer_movements (id, shift_id, actor_id, movement_type, amount, reason, created_at)
     values ($1,$2,$3,'OPENING_FLOAT',$4,'Modal awal laci kasir',$5) on conflict (id) do nothing`,
    [uid("cm-shift-matched-open"), shiftMatchedId, user.kasir2, money(300000), iso(tMatchedOpen)],
  );

  // 2) Shift CLOSED_WITH_VARIANCE milik kasir2 (kemarin, minus 75 ribu)
  const shiftVarianceId = uid("shift-variance");
  const tVarOpen = daysAgo(1, 8, 0);
  const tVarClose = daysAgo(1, 17, 10);
  await q(
    `insert into pos_shifts (id, shift_number, cashier_id, terminal_id, status, opened_at, opening_cash,
         closed_at, expected_cash_system, actual_cash_counted, cash_variance, total_sales_gross, total_discounts,
         total_tax, total_net_sales, total_cash_sales, total_non_cash_sales, total_void_amount, closing_notes)
     values ($1,'SHF-SEED-0002',$2,'KASIR-02','CLOSED_WITH_VARIANCE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$15)
     on conflict (shift_number) do nothing`,
    [
      shiftVarianceId,
      user.kasir2,
      iso(tVarOpen),
      money(300000),    // opening_cash
      iso(tVarClose),   // closed_at
      money(1843000),   // expected_cash_system
      money(1768000),   // actual_cash_counted
      money(-75000),    // cash_variance
      money(2210000),   // total_sales_gross
      money(118000),    // total_discounts
      money(47000),     // total_tax
      money(2210000),   // total_net_sales
      money(1313000),   // total_cash_sales
      money(897000),    // total_non_cash_sales
      "Kasir menyebut ada pembeli antre saat pergantian shift; selisih belum ditemukan.",
    ],
  );
  await q(
    `insert into cash_drawer_movements (id, shift_id, actor_id, movement_type, amount, reason, created_at)
     values ($1,$2,$3,'OPENING_FLOAT',$4,'Modal awal laci kasir',$5) on conflict (id) do nothing`,
    [uid("cm-shift-variance-open"), shiftVarianceId, user.kasir2, money(300000), iso(tVarOpen)],
  );
  await q(
    `insert into cash_drawer_movements (id, shift_id, actor_id, authorized_by, movement_type, amount, reason, created_at)
     values ($1,$2,$3,$4,'CASH_OUT_EXPENSE',$5,'Beli galon air minum untuk toko',$6) on conflict (id) do nothing`,
    [uid("cm-shift-variance-galon"), shiftVarianceId, user.kasir2, user.manager, money(30000), iso(daysAgo(1, 11, 20))],
  );

  // 3) Shift OPEN milik kasir1 (hari ini) — terminal langsung siap bayar
  const shiftOpenId = uid("shift-open");
  const tOpen = daysAgo(0, 7, 30);
  await q(
    `insert into pos_shifts (id, shift_number, cashier_id, terminal_id, status, opened_at, opening_cash)
     values ($1,'SHF-SEED-0003',$2,'KASIR-01','OPEN',$3,$4)
     on conflict (shift_number) do nothing`,
    [shiftOpenId, user.kasir1, iso(tOpen), money(500000)],
  );
  await q(
    `insert into cash_drawer_movements (id, shift_id, actor_id, movement_type, amount, reason, created_at)
     values ($1,$2,$3,'OPENING_FLOAT',$4,'Modal awal laci kasir',$5) on conflict (id) do nothing`,
    [uid("cm-shift-open-float"), shiftOpenId, user.kasir1, money(500000), iso(tOpen)],
  );
  console.log("[db:seed] 3 sesi shift siap (1 OPEN, 1 cocok, 1 selisih -75rb)");

  /* ------------------------------------------------- initial stock ledger */
  let ledgerSeq = 0;
  for (const row of PRODUCTS) {
    await addLedger({
      key: row.key,
      seq: ledgerSeq++,
      type: "INITIAL_SEED",
      ref: "SEED-INITIAL",
      delta: row.stock,
      before: 0,
      after: row.stock,
      unitCost: row.cost,
      actor: user.gudang,
      notes: "Stok awal toko dari data seed",
      at: daysAgo(35, 9, 0),
    });
  }
  // satu penerimaan supplier untuk produk erosi margin (harga beli naik)
  await q(
    `insert into purchase_receipts (id, receipt_number, supplier_id, received_by, received_at, total_amount, notes)
     values ($1,'PRC-SEED-0001',(select id from suppliers where code='SUP-001'),$2,$3,$4,'Kenaikan harga beli supplier')
     on conflict (id) do nothing`,
    [uid("pr-001"), user.gudang, iso(daysAgo(9, 10, 0)), money(15800 * 60)],
  );
  await q(
    `insert into purchase_receipt_items (id, receipt_id, product_id, qty, unit_cost, line_total)
     values ($1,$2,$3,60,$4,$5)
     on conflict (id) do nothing`,
    [uid("pri-001"), uid("pr-001"), P.sabunpingan, money(15800), money(15800 * 60)],
  );
  await addLedger({
    key: "sabunpingan",
    seq: ledgerSeq++,
    type: "PURCHASE_RECEIVE",
    ref: "PRC-SEED-0001",
    delta: 60,
    before: 6,
    after: 66,
    unitCost: 15800,
    actor: user.gudang,
    notes: "Harga beli supplier naik 12.800 → 15.800; HPP rata-rata terngkat",
    at: daysAgo(9, 10, 0),
  });
  console.log("[db:seed] kartu stok awal + 1 penerimaan supplier siap");

  /* ---------------------------------------------------- 12 sales orders */
  const at = (days, hour, minute) => daysAgo(days, hour, minute);
  const promoHemat = uid("promo-HEMAT10");
  const promoGrosir = uid("promo-GROSIR5K");
  const promoMember = uid("promo-MEMBER15");

  // — Shift CLOSED_MATCHED (kasir2, 2 hari lalu): 4 transaksi
  await insertSale({ key: "s01", shiftId: shiftMatchedId, cashierId: user.kasir2, at: at(2, 9, 12), method: "CASH", cash: 50000, change: 6000, lines: [{ key: "tehkotak", qty: 12 }, { key: "air600", qty: 2 }], promoId: null });
  await insertSale({ key: "s02", shiftId: shiftMatchedId, cashierId: user.kasir2, customer: "MBR-00003", memberPct: 5, at: at(2, 11, 40), method: "QRIS", ref: "QRIS-SEED-9911", lines: [{ key: "beras", qty: 2 }, { key: "gula", qty: 6 }] });
  await insertSale({ key: "s03", shiftId: shiftMatchedId, cashierId: user.kasir2, promoId: promoHemat, promo: PROMO_HEMAT, at: at(2, 13, 5), method: "CASH", cash: 250000, change: 3400, lines: [{ key: "susuUHT", qty: 6 }, { key: "santan", qty: 12 }, { key: "bukutulis", qty: 4 }] });
  await insertSale({ key: "s04", shiftId: shiftMatchedId, cashierId: user.kasir2, at: at(2, 15, 30), method: "DEBIT_CARD", ref: "EDC-SEED-4432", lines: [{ key: "pulpen", qty: 24 }, { key: "pensil2b", qty: 24 }] });

  // — Shift CLOSED_WITH_VARIANCE (kasir2, kemarin): 4 transaksi, 1 VOIDED
  const voided = await insertSale({ key: "s05", shiftId: shiftVarianceId, cashierId: user.kasir2, at: at(1, 9, 25), method: "CASH", cash: 400000, change: 0, lines: [{ key: "minyak", qty: 2 }, { key: "gula", qty: 12 }], voided: true, voidReason: "Kasir salah memasukkan item gula 12 pcs, pelanggan batal" });
  await insertSale({ key: "s06", shiftId: shiftVarianceId, cashierId: user.kasir2, customer: "MBR-00002", memberPct: 2, at: at(1, 10, 50), method: "CASH", cash: 100000, change: 0, lines: [{ key: "kopisachet", qty: 24 }, { key: "tehkotak", qty: 6 }] });
  await insertSale({ key: "s07", shiftId: shiftVarianceId, cashierId: user.kasir2, promoId: promoGrosir, promo: PROMO_GROSIR, at: at(1, 12, 35), method: "SPLIT_PAYMENT", ref: "QRIS-SEED-7723", lines: [{ key: "beras", qty: 6 }, { key: "minyak", qty: 2 }, { key: "deterjen", qty: 3 }] });
  await insertSale({ key: "s08", shiftId: shiftVarianceId, cashierId: user.kasir2, customer: "MBR-00004", memberPct: 8, manual: 5000, at: at(1, 16, 20), method: "CASH", cash: 360000, change: 2100, lines: [{ key: "lampuded", qty: 6 }, { key: "sabunpingan", qty: 12 }] });

  // — Shift OPEN (kasir1, hari ini): 4 transaksi, 1 SYNCED_FROM_OFFLINE
  await insertSale({ key: "s09", shiftId: shiftOpenId, cashierId: user.kasir1, at: at(0, 8, 40), method: "CASH", cash: 30000, change: 2600, lines: [{ key: "air600", qty: 6 }, { key: "kopisachet", qty: 3 }] });
  await insertSale({ key: "s10", shiftId: shiftOpenId, cashierId: user.kasir1, promoId: promoMember, promo: PROMO_MEMBER, at: at(0, 9, 55), method: "QRIS", ref: "QRIS-SEED-1180", lines: [{ key: "gula", qty: 12 }, { key: "beras", qty: 6 }] });
  const offlineSale = await insertSale({ key: "s11", shiftId: shiftOpenId, cashierId: user.kasir1, at: at(0, 10, 30), method: "CASH", cash: 90000, change: 0, sync: true, offlineAt: at(0, 10, 12), receiptNumber: nextReceipt(at(0, 10, 12)), lines: [{ key: "tehkotak", qty: 12 }, { key: "pulpen", qty: 12 }] });
  await insertSale({ key: "s12", shiftId: shiftOpenId, cashierId: user.kasir1, customer: "MBR-00001", at: at(0, 11, 15), method: "SPLIT_PAYMENT", ref: "QRIS-SEED-3391", lines: [{ key: "santan", qty: 12 }, { key: "susuUHT", qty: 6 }, { key: "bukutulis", qty: 12 }] });

  // POS_SALE ledger untuk seluruh item terjual (VOIDED masuk sebagai retur stok)
  // indexes are per-order, so we keep the insert simpler: sold lines adjusted in DB below
  const soldRows = (await q(
    `select soi.product_id, soi.qty, soi.unit_cogs_snapshot, so.receipt_number, so.status, so.created_at, so.cashier_id
     from sales_order_items soi join sales_orders so on so.id = soi.order_id
     order by so.created_at, soi.sku_snapshot`,
  )).rows;
  const runningStock = new Map(PRODUCTS.map((row) => [row.key, row.stock]));
  // ledger baris POS_SALE hanya untuk transaksi non-void (void ditangani POS_VOID_RETURN di bawah)
  const stockByProduct = new Map(PRODUCTS.map((row) => [row.key, row.stock]));
  for (const row of soldRows) {
    if (row.status === "VOIDED") continue;
    const key = [...Object.entries(P)].find(([, id]) => id === row.product_id)?.[0];
    if (!key) continue;
    const before = stockByProduct.get(key);
    const after = before - row.qty;
    stockByProduct.set(key, after);
    await addLedger({
      key,
      seq: ledgerSeq++,
      type: "POS_SALE",
      ref: row.receipt_number,
      delta: -row.qty,
      before,
      after,
      unitCost: row.unit_cogs_snapshot,
      actor: row.cashier_id,
      notes: "Penjualan kasir (seed)",
      at: row.created_at,
    });
  }
  // void: stok kembali (dicatat POS_VOID_RETURN oleh supervisor)
  const voidItems = (await q(
    `select soi.product_id, soi.qty, soi.unit_cogs_snapshot, so.receipt_number, so.voided_at, so.voided_by_supervisor
     from sales_order_items soi join sales_orders so on so.id = soi.order_id where so.status = 'VOIDED'`,
  )).rows;
  for (const row of voidItems) {
    const key = [...Object.entries(P)].find(([, id]) => id === row.product_id)?.[0];
    if (!key) continue;
    const before = stockByProduct.get(key);
    const after = before + row.qty;
    stockByProduct.set(key, after);
    await addLedger({
      key,
      seq: ledgerSeq++,
      type: "POS_VOID_RETURN",
      ref: row.receipt_number,
      delta: row.qty,
      before,
      after,
      unitCost: row.unit_cogs_snapshot,
      actor: row.voided_by_supervisor,
      notes: "Void struk: stok dikembalikan",
      at: row.voided_at,
    });
  }
  // sinkronkan products.stock_on_hand dengan hasil ledger berjalan
  for (const [key, after] of stockByProduct) {
    await q(`update products set stock_on_hand = $1 where id = $2`, [after, P[key]]);
  }
  console.log("[db:seed] 12 transaksi POS + kartu stok berjalan siap");

  /* -------------------------------------------- offline sync conflict row */
  // Transaksi offline sudah terjual (s11) tapi server mencatat stok teh kotak
  // lebih kecil dari yang dipotong — konflik terbuka untuk review Manajer.
  await q(
    `insert into offline_sync_conflicts (id, order_id, product_id, client_request_id, conflict_type,
         server_qty_before, offline_qty_sold, resolved)
     values ($1,$2,$3,'seed-s11','NEGATIVE_STOCK',$4,12,false)
     on conflict (id) do nothing`,
    [uid("conflict-1"), offlineSale.orderId, P.tehkotak, Math.max(0, (stockByProduct.get("tehkotak") ?? 0) - 12)],
  );
  console.log("[db:seed] 1 konflik sinkronisasi offline (NEGATIVE_STOCK) siap");

  /* ------------------------------------------------------ stock opname */
  const opnameId = uid("opname-1");
  const opnameAt = daysAgo(4, 15, 0);
  await q(
    `insert into stock_opnames (id, opname_number, status, created_by, approved_by, approved_at, notes, total_variance_value, created_at)
     values ($1,'OPN-SEED-001','APPROVED',$2,$3,$4,$5,$6,$7)
     on conflict (id) do nothing`,
    [opnameId, user.gudang, user.manager, iso(opnameAt), "Opname bulanan rak minuman; 3 unit teh kotak rusak kemasan", money(-3 * 3850), iso(opnameAt)],
  );
  const tehStockAtOpname = (stockByProduct.get("tehkotak") ?? 0) + 12; // 12 unit terjual sesudah opname
  await q(
    `insert into stock_opname_items (id, opname_id, product_id, system_qty_snapshot, physical_qty_counted, variance_qty, variance_value_idr)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do nothing`,
    [uid("opname-item-1"), opnameId, P.tehkotak, tehStockAtOpname, tehStockAtOpname - 3, -3, money(-3 * 3850)],
  );
  await addLedger({
    key: "tehkotak",
    seq: ledgerSeq++,
    type: "OPNAME_ADJUSTMENT",
    ref: "OPN-SEED-001",
    delta: -3,
    before: tehStockAtOpname - 3 + 3,
    after: tehStockAtOpname - 3,
    unitCost: 3850,
    actor: user.manager,
    notes: "Opname disetujui: 3 unit rusak kemasan",
    at: opnameAt,
  });
  console.log("[db:seed] 1 dokumen stock opname disetujui siap");

  /* ---------------------------------------------------- decision log seed */
  await q(
    `insert into decision_logs (id, rule_code, subject_id, subject_label, payload, status, acted_by, acted_at, created_at)
     values ($1,'CASHIER_RISK_ANOMALY',$2,'Putri Lestari',$3,'NEW',null,null,$4)
     on conflict (id) do nothing`,
    [
      uid("dlog-1"),
      user.kasir2,
      JSON.stringify({ shortage: -75000, note: "Seed: selisih kas shift SHF-SEED-0002" }),
      iso(daysAgo(1, 17, 15)),
    ],
  );

  /* ------------------------------------------------------------- receipts */
  for (const [key, prefix, nextValue] of [
    ["receipt", "INV-YYYYMMDD", 2001],
    ["shift", "SHF-YYYYMM", 4],
    ["customer", "MBR", 6],
    ["purchase", "PRC-YYYYMMDD", 2],
    ["opname", "OPN-YYYYMMDD", 2],
    ["return", "RTR-YYYYMMDD", 1],
  ]) {
    await q(
      `insert into document_sequences (key, prefix, next_value) values ($1,$2,$3)
       on conflict (key) do update set prefix = excluded.prefix,
         next_value = greatest(document_sequences.next_value, excluded.next_value)`,
      [key, prefix, nextValue],
    );
  }

  console.log("[db:seed] SELESAI — dataset demo lengkap & idempoten.");
  await db.close();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[db:seed] GAGAL:", error);
  process.exit(1);
});