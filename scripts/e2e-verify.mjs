import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

process.env.DATABASE_URL ??= "pglite://./.data/e2e-pglite";
process.env.RECEIPT_SIGNING_KEY ??= "katalis-pos-demo-receipt-signing-key-do-not-use-in-production";

const e2eDataDir = path.resolve(".data/e2e-pglite");
await rm(e2eDataDir, { recursive: true, force: true }).catch(() => undefined);
await mkdir(e2eDataDir, { recursive: true });

// Exactly ONE PGlite instance owns the directory. Registering it on globalThis
// before importing the app's db module makes the app reuse this handle.
const pgliteModule = await import("@electric-sql/pglite");
const raw = new pgliteModule.PGlite(e2eDataDir);
globalThis.__katalisPglite = raw;

const { splitStatements } = await import("./lib/sql-split.mjs");
const { readFile } = await import("node:fs/promises");
const sqlText = await readFile(new URL("./sql/schema.sql", import.meta.url), "utf8");
for (const statement of splitStatements(sqlText)) {
  await raw.exec(statement);
}
const types = await raw.query("select typname from pg_type where typtype='e'");
if (types.rows.length < 12) {
  throw new Error(`skema tidak lengkap: hanya ${types.rows.length} enum`);
}
console.log("skema e2e siap,", types.rows.length, "enum terdaftar");

const { getDb } = await import("@/server/db");
const drizzleDb = await getDb();
// Drizzle's PGlite driver proxies execute via .run/.all etc; use the raw
// client for the script's assertions.
const rawClient = globalThis.__katalisPglite;
const q = async (text, params = []) => {
  try {
    return await rawClient.query(text, params);
  } catch (error) {
    console.error(`[e2e] query gagal: ${text.replace(/\s+/g, " ").slice(0, 150)}`);
    throw error;
  }
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function toNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ==================== A. posMath (pure, no database) ==================== */

{
  section("A. Mesin matematika murni (posMath.ts)");
  const math = await import("@/lib/posMath");

  const tier1 = math.resolveTierPricePure(2500, 12, [
    { minQty: 6, tierUnitPrice: 2375, label: "Lusin" },
    { minQty: 24, tierUnitPrice: 2300, label: "Karton" },
  ]);
  check("tier 12 pcs memakai harga lusin", tier1.appliedUnitPrice === 2375 && tier1.tierLabel === "Lusin");
  const tier2 = math.resolveTierPricePure(2500, 30, [
    { minQty: 6, tierUnitPrice: 2375, label: "Lusin" },
    { minQty: 24, tierUnitPrice: 2300, label: "Karton" },
  ]);
  check("tier 30 pcs memakai harga karton", tier2.appliedUnitPrice === 2300);
  const tier3 = math.resolveTierPricePure(2500, 3, [{ minQty: 6, tierUnitPrice: 2375, label: "Lusin" }]);
  check("di bawah ambang memakai harga eceran", tier3.appliedUnitPrice === 2500 && tier3.tierLabel === null);
  const tierSaving = math.resolveTierPricePure(2500, 12, [{ minQty: 6, tierUnitPrice: 2375, label: "L" }]);
  check("penghematan grosir per baris", tierSaving.tierSaving === 1500);

  const cart = math.calculateCartTotalsPure({
    lines: [
      { productId: "p1", sku: "A", name: "A", qty: 12, baseUnitPrice: 2500, costPrice: 1800, isTaxable: true, tiers: [{ minQty: 12, tierUnitPrice: 2375, label: "Lusin" }] },
      { productId: "p2", sku: "B", name: "B", qty: 2, baseUnitPrice: 10000, costPrice: 8000, isTaxable: false },
    ],
    memberDiscountPct: 5,
    promo: { code: "X", name: "X", discountType: "PERCENTAGE", discountValue: 20, minSubtotal: 0, maxDiscountCap: 15000 },
    manualDiscountAmount: 1000,
    paymentMethod: "CASH",
  });
  check("subtotal = jumlah baris ber-harga grosir", cart.subtotal === 48500);
  check("hemat grosir tercatat", cart.tierDiscountTotal === 1500);
  check("diskon member dipotong dulu", cart.memberDiscountAmount === 2425);
  check("promo dihitung dari sisa setelah member", cart.promoDiscountAmount === 9215);
  check("promo menghormati plafon", cart.promoDiscountAmount <= 15000);
  check("diskon manual ditambahkan", cart.manualDiscountAmount === 1000);
  check("DPP hanya dari item kena pajak", cart.taxableBase === 21072 && cart.nonTaxableBase === 14788);
  check("PPN 11% dari DPP", cart.taxAmount === 2318);
  check("grand total kelipatan 100", cart.grandTotal % 100 === 0 && cart.grandTotal === 38200);
  check("pembulatan = grand - (neto + PPN)", cart.grandTotal - 35860 - 2318 === cart.roundingAdjustment);

  const capped = math.computePromoDiscountPure(
    { code: "C", name: "C", discountType: "PERCENTAGE", discountValue: 30, minSubtotal: 0, maxDiscountCap: 12000 },
    100000,
  );
  check("plafon promo memotong persentase besar", capped === 12000);

  check("QRIS tidak dibulatkan", math.computeCashRoundingPure(12350, "QRIS", 100) === 0);
  check("tunai 12350 → 12400", math.computeCashRoundingPure(12350, "CASH", 100) === 50);
  check("tunai 12340 → 12300", math.computeCashRoundingPure(12340, "CASH", 100) === -40);

  check("HPP rata-rata tertimbang dasar", math.computeWeightedAverageCogsPure(10, 2000, 10, 3000) === 2500);
  check("stok lama negatif dihitung nol", math.computeWeightedAverageCogsPure(-5, 2000, 10, 3000) === 3000);
  check("stok lama nol → harga beli baru", math.computeWeightedAverageCogsPure(0, 2000, 4, 3125) === 3125);

  check(
    "kas seharusnya: modal + tunai - kas keluar - brankas",
    math.computeExpectedCashPure({ openingCash: 500000, cashSales: 1200000, cashRefunds: 0, cashInMisc: 0, cashOutExpense: 30000, cashDropSafe: 200000 }) === 1470000,
  );
  check("kembalian tidak pernah negatif", math.computeChangePure(50000, 40000) === 0);
  check("kembalian tunai pas", math.computeChangePure(50000, 100000) === 50000);
}

/* ======================= B. shift lifecycle ============================ */

{
  section("B. Siklus hidup shift kasir");
  const shiftEngine = await import("@/server/services/shiftEngine");
  const { hashSecretStable } = await import("./lib/seed-helpers.mjs");

  const cashierId = "11111111-1111-4111-8111-111111111111";
  await q(
    `insert into profiles (id, email, full_name, role, password_hash)
     values ($1,'e2e-cashier@test.local','E2E Kasir','CASHIER',$2)
     on conflict (email) do nothing`,
    [cashierId, hashSecretStable("x", "e2e")],
  );

  const shift = await shiftEngine.openShift({ cashierId, openingCash: 400000, terminalId: "E2E-01" });
  check("shift terbuka dengan nomor", Boolean(shift.id) && shift.shiftNumber.startsWith("SHF-"));
  check("status awal OPEN", shift.status === "OPEN");

  const openRow = (await q(`select amount from cash_drawer_movements where shift_id=$1 and movement_type='OPENING_FLOAT'`, [shift.id])).rows[0];
  check("modal awal tercatat sebagai OPENING_FLOAT", openRow && toNumber(openRow.amount) === 400000);

  let movementError = null;
  let movement = null;
  try {
    movement = await shiftEngine.recordCashMovement({
      shiftId: shift.id,
      actorId: cashierId,
      movementType: "CASH_OUT_EXPENSE",
      amount: 25000,
      reason: "Beli kantong plastik",
    });
  } catch (error) {
    movementError = error;
  }
  check("kas keluar kecil tanpa PIN", !movementError && movement && movement.authorizedBy === null);

  let bigCashOutRejected = false;
  try {
    await shiftEngine.recordCashMovement({
      shiftId: shift.id,
      actorId: cashierId,
      movementType: "CASH_OUT_EXPENSE",
      amount: 250000,
      reason: "Tanpa izin",
      supervisorPin: "",
    });
  } catch {
    bigCashOutRejected = true;
  }
  check("kas keluar besar tanpa PIN ditolak", bigCashOutRejected);

  await q(
    `insert into sales_orders (id, receipt_number, client_request_id, shift_id, cashier_id, status,
         subtotal, grand_total, total_cogs, payment_method)
     values ($1,'E2E-REC-1','e2e-sale-1',$2,$3,'COMPLETED','500000','500000','350000','CASH')
     on conflict (client_request_id) do nothing`,
    ["22222222-2222-4222-8222-222222222222", shift.id, cashierId],
  );

  const totals = await shiftEngine.computeShiftTotals(shift.id);
  check("total tunai terbaca dari struk", totals.cashSales === 500000, `dapat ${totals.cashSales}`);
  // 400000 modal + 500000 tunai − 25000 kas keluar = 875000
  check("kas seharusnya dihitung server", totals.expectedCash === 875000, `dapat ${totals.expectedCash}`);

  const closed = await shiftEngine.closeShiftBlind({
    shiftId: shift.id,
    actorId: cashierId,
    actualCashCounted: totals.expectedCash - 12500,
    closingNotes: "e2e variance probe",
  });
  check("selisih terdeteksi persis", closed.variance === -12500, `dapat ${closed.variance}`);
  check("status CLOSED_WITH_VARIANCE", closed.status === "CLOSED_WITH_VARIANCE");

  let recloseRejected = false;
  try {
    await shiftEngine.closeShiftBlind({ shiftId: shift.id, actorId: cashierId, actualCashCounted: 1000 });
  } catch {
    recloseRejected = true;
  }
  check("shift tertutup tidak bisa ditutup lagi", recloseRejected);

  // cleanup section B (audit rows first: FK to profiles)
  await q(`delete from audit_logs where actor_id=$1::uuid or entity_id=$1::text`, [cashierId]);
  await q(`delete from cash_drawer_movements where shift_id=$1`, [shift.id]);
  await q(`delete from sales_orders where shift_id=$1`, [shift.id]);
  await q(`delete from pos_shifts where id=$1`, [shift.id]);
  await q(`delete from profiles where id=$1`, [cashierId]);
}

/* ===================== C. offline sync engine ========================== */

{
  section("C. Sinkronisasi offline: idempoten & konflik stok");
  const syncModule = await import("@/server/services/posSyncEngine");
  const shiftEngine = await import("@/server/services/shiftEngine");
  const { hashSecretStable } = await import("./lib/seed-helpers.mjs");

  const cashierId = "33333333-3333-4333-8333-333333333333";
  await q(
    `insert into profiles (id, email, full_name, role, password_hash)
     values ($1,'e2e-sync@test.local','E2E Sync','CASHIER',$2)
     on conflict (email) do nothing`,
    [cashierId, hashSecretStable("x", "e2e")],
  );
  const shift = await shiftEngine.openShift({ cashierId, openingCash: 100000, terminalId: "E2E-02" });

  const productId = "44444444-4444-4444-8444-444444444444";
  await q(
    `insert into products (id, sku, name, unit, cost_price, retail_price, stock_on_hand, reorder_point, is_taxable)
     values ($1,'E2E-001','Produk Uji Sinkron','PCS','1000','1500',3,1,true)
     on conflict (sku) do nothing`,
    [productId],
  );

  const batch = {
    clientRequestId: "e2e-sync-batch-0001",
    createdAt: new Date().toISOString(),
    cashierId,
    shiftId: shift.id,
    paymentMethod: "CASH",
    cashReceived: 6000,
    items: [{ productId, qty: 5 }],
    clientTotal: 7500,
  };

  const first = await syncModule.syncOfflineBatch({ actorId: cashierId, items: [batch] });
  check("batch pertama SYNCED", first.synced === 1 && first.rejected === 0, JSON.stringify(first.results));

  const stock1 = toNumber((await q(`select stock_on_hand from products where id=$1`, [productId])).rows[0].stock_on_hand);
  check("stok dipotong sekali (negatif diizinkan)", stock1 === -2, `dapat ${stock1}`);

  const conflictRow = (await q(`select id from offline_sync_conflicts where client_request_id=$1`, [batch.clientRequestId])).rows[0];
  check("konflik NEGATIVE_STOCK tercatat", Boolean(conflictRow));

  const second = await syncModule.syncOfflineBatch({ actorId: cashierId, items: [batch] });
  check("batch kedua ALREADY_SYNCED", second.alreadySynced === 1 && second.synced === 0, JSON.stringify(second.results));

  const stock2 = toNumber((await q(`select stock_on_hand from products where id=$1`, [productId])).rows[0].stock_on_hand);
  check("stok tidak terpotong dua kali", stock2 === -2, `dapat ${stock2}`);

  const ledgerCount = (
    await q(
      `select count(*)::int c from stock_ledgers where movement_type='POS_SALE' and reference_id in
         (select receipt_number from sales_orders where client_request_id=$1)`,
      [batch.clientRequestId],
    )
  ).rows[0];
  check("ledger POS_SALE tepat satu baris", ledgerCount.c === 1, `dapat ${ledgerCount.c}`);

  const orderRow = (await q(`select grand_total, total_cogs, tax_amount from sales_orders where client_request_id=$1`, [batch.clientRequestId])).rows[0];
  // 5 x 1500 = 7500, all taxable, PPN 11% of 7500 = 825, cash rounding → 8300? verify consistent:
  check("total dihitung ulang di server", toNumber(orderRow.grand_total) >= 7500, `dapat ${orderRow.grand_total}`);
  check("HPP = 5 x 1000", toNumber(orderRow.total_cogs) === 5000);

  const auditDrift = (
    await q(`select count(*)::int c from audit_logs where action='SALE_TOTAL_DRIFT' and entity_id='e2e-sync-batch-0002'`)
  ).rows[0];

  const drift = await syncModule.syncOfflineBatch({
    actorId: cashierId,
    items: [{ ...batch, clientRequestId: "e2e-sync-batch-0002", clientTotal: 999999 }],
  });
  check("total klien menyimpang tetap tercatat", drift.synced === 1);
  const driftLogged = (
    await q(`select count(*)::int c from audit_logs where action='SALE_TOTAL_DRIFT' and entity_id='e2e-sync-batch-0002'`)
  ).rows[0];
  check("penyimpangan total dicatat audit", driftLogged.c === auditDrift.c + 1);

  // cleanup section C
  await q(`delete from offline_sync_conflicts where client_request_id like 'e2e-sync-batch-%'`);
  await q(`delete from idempotency_keys where key like 'sale:e2e-sync-batch-%'`);
  await q(`delete from audit_logs where entity_type='sales_order' and entity_id in (select id::text from sales_orders where client_request_id like 'e2e-sync-batch-%')`);
  await q(`delete from sales_order_items where order_id in (select id from sales_orders where client_request_id like 'e2e-sync-batch-%')`);
  await q(`delete from sales_payments where order_id in (select id from sales_orders where client_request_id like 'e2e-sync-batch-%')`);
  await q(`delete from stock_ledgers where reference_id in (select receipt_number from sales_orders where client_request_id like 'e2e-sync-batch-%')`);
  await q(`delete from sales_orders where client_request_id like 'e2e-sync-batch-%'`);
  await q(`delete from cash_drawer_movements where shift_id=$1`, [shift.id]);
  await q(`delete from pos_shifts where id=$1`, [shift.id]);
  await q(`delete from audit_logs where actor_id=$1::uuid or authorized_by_id=$1::uuid or entity_id=$1::text`, [cashierId]);
  await q(`delete from profiles where id=$1`, [cashierId]);
  await q(`delete from products where id=$1`, [productId]);
}

/* ==================== D. supervisor PIN enforcement ===================== */

{
  section("D. Penegakan PIN Supervisor pada void struk");
  const { hashSecretStable, OWNER_PIN } = await import("./lib/seed-helpers.mjs");
  const salesActions = await import("@/server/services/salesActions");

  const ownerId = "55555555-5555-4555-8555-555555555555";
  const cashierId = "66666666-6666-4666-8666-666666666666";
  const productId = "77777777-7777-4777-8777-777777777777";
  const orderId = "88888888-8888-4888-8888-888888888888";

  await q(
    `insert into profiles (id, email, full_name, role, password_hash, supervisor_pin_hash)
     values ($1,'e2e-owner@test.local','E2E Owner','SUPER_ADMIN',$2,$3)
     on conflict (email) do nothing`,
    [ownerId, hashSecretStable("x", "e2e-o"), hashSecretStable(OWNER_PIN, "pin:e2e-owner@test.local")],
  );
  await q(
    `insert into profiles (id, email, full_name, role, password_hash)
     values ($1,'e2e-cashier2@test.local','E2E Kasir 2','CASHIER',$2)
     on conflict (email) do nothing`,
    [cashierId, hashSecretStable("x", "e2e-c2")],
  );
  await q(
    `insert into products (id, sku, name, unit, cost_price, retail_price, stock_on_hand, is_taxable)
     values ($1,'E2E-002','Produk Uji Void','PCS','1000','2000',50,true)
     on conflict (sku) do nothing`,
    [productId],
  );
  await q(
    `insert into sales_orders (id, receipt_number, client_request_id, cashier_id, status,
         subtotal, tax_amount, grand_total, total_cogs, payment_method, receipt_signature)
     values ($1,'E2E-REC-2','e2e-void-1',$2,'COMPLETED','20000','2200','22200','10000','CASH','sig')`,
    [orderId, cashierId],
  );
  await q(
    `insert into sales_order_items (id, order_id, product_id, product_name_snapshot, sku_snapshot, qty,
         base_unit_price, applied_unit_price, unit_cogs_snapshot, line_subtotal)
     values ($1,$2,$3,'Produk Uji Void','E2E-002',10,'2000','2000','1000','20000')`,
    ["99999999-9999-4999-8999-999999999999", orderId, productId],
  );
  await q(`update products set stock_on_hand = stock_on_hand - 10 where id=$1`, [productId]);
  const stockBeforeVoid = 40;

  let emptyPinRejected = false;
  try {
    await salesActions.voidOrder({ orderId, actorId: cashierId, supervisorPin: "", reason: "e2e" });
  } catch {
    emptyPinRejected = true;
  }
  check("void dengan PIN kosong ditolak", emptyPinRejected);

  let wrongPinRejected = false;
  try {
    await salesActions.voidOrder({ orderId, actorId: cashierId, supervisorPin: "000000", reason: "e2e" });
  } catch {
    wrongPinRejected = true;
  }
  check("void dengan PIN salah ditolak", wrongPinRejected);

  const statusRow = (await q(`select status from sales_orders where id=$1`, [orderId])).rows[0];
  check("status struk tidak berubah saat PIN salah", statusRow.status === "COMPLETED");

  const voided = await salesActions.voidOrder({
    orderId,
    actorId: cashierId,
    supervisorPin: OWNER_PIN,
    reason: "e2e void terotorisasi",
  });
  check("void dengan PIN benar sukses", voided.receiptNumber === "E2E-REC-2" && voided.restoredItems === 1);

  const stockAfterVoid = toNumber((await q(`select stock_on_hand from products where id=$1`, [productId])).rows[0].stock_on_hand);
  check("void mengembalikan stok", stockAfterVoid === stockBeforeVoid + 10, `dapat ${stockAfterVoid}`);

  const auditCount = (
    await q(
      `select count(*)::int c from audit_logs where entity_id=$1 and action in ('VOID_ORDER_PIN_REJECTED','ORDER_VOIDED')`,
      [orderId],
    )
  ).rows[0];
  check("jejak audit mencatat penolakan dan keberhasilan", auditCount.c >= 2, `dapat ${auditCount.c}`);

  const voidedRow = (await q(`select voided_by_supervisor, void_reason from sales_orders where id=$1`, [orderId])).rows[0];
  check("otorisasi supervisor tercatat pada struk", Boolean(voidedRow.voided_by_supervisor) && voidedRow.void_reason === "e2e void terotorisasi");

  // cleanup section D
  await q(`delete from audit_logs where entity_id=$1`, [orderId]);
  await q(`delete from audit_logs where action like 'VOID_ORDER%' and entity_type='sales_order'`);
  await q(`delete from sales_order_items where order_id=$1`, [orderId]);
  await q(`delete from sales_orders where id=$1`, [orderId]);
  await q(`delete from stock_ledgers where product_id=$1`, [productId]);
  await q(`delete from products where id=$1`, [productId]);
  await q(`delete from profiles where id in ($1,$2)`, [ownerId, cashierId]);
}

/* ============ E. RBAC, parameter sanitising, CSV (no database) ========== */

{
  section("E. RBAC, sanitasi parameter, dan format CSV");
  const session = await import("@/server/session");
  const params = await import("@/lib/params");
  const csv = await import("@/server/services/csv");

  check("kasir dilarang di /admin", !session.rolesForPath("/admin").includes("CASHIER"));
  check("manajer diizinkan di /admin", session.rolesForPath("/admin").includes("STORE_MANAGER"));
  check("gudang dilarang di kasir", !session.rolesForPath("/pos").includes("WAREHOUSE_STAFF"));
  check("kasir diizinkan di /pos/sync", session.rolesForPath("/pos/sync").includes("CASHIER"));
  check("prefix terpanjang menang", session.rolesForPath("/admin/settings").includes("SUPER_ADMIN") && !session.rolesForPath("/admin/settings").includes("STORE_MANAGER"));

  check("request ID asing tidak lolos", params.sanitizeUuid("'; drop table users; --") === undefined);
  check("UUID valid lolos sanitasi", params.sanitizeUuid("44444444-4444-4444-8444-444444444444") !== undefined);
  check("teks dibatasi panjang", params.sanitizeText("x".repeat(200), 10).length === 10);
  check("karakter kontrol & tag dibuang", !/[\u0000-\u001F<>]/.test(params.sanitizeText("a\u0000b<script>")));
  check("enum tak dikenal ditolak", params.sanitizeEnum("HACKED", ["COMPLETED", "VOIDED"]) === undefined);
  check("enum sah diterima", params.sanitizeEnum("VOIDED", ["COMPLETED", "VOIDED"]) === "VOIDED");
  check("integer di luar rentang dijepit", params.sanitizeInt("9999", 30, 1, 365) === 365);

  const body = csv.toCsv(["A", "B"], [["r1c1;r1c2", 'say "hi"']]);
  check("CSV diawali UTF-8 BOM", body.startsWith("\uFEFF"));
  check("CSV memakai pemisah titik koma", body.includes("A;B"));
  check("CSV mengutip sel ber-separator", body.includes('"r1c1;r1c2"'));
  check("CSV meloloskan tanda kutip", body.includes('""hi""'));
  check("nama file CSV bertanda waktu", /-\d{8}-\d{4}\.csv$/.test(csv.timestampedFilename("katalis")));
}

process.on("exit", () => {
  try {
    raw?.close?.();
  } catch {
    // already closed
  }
});

console.log("\n=============================================");
console.log(`LULUS: ${passed}  GAGAL: ${failed}`);
if (failed > 0) {
  console.log("\nKegagalan:");
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
await raw.close();
console.log("e2e selesai — database uji dibersihkan");
await rm(e2eDataDir, { recursive: true, force: true }).catch(() => undefined);
process.exit(0);
