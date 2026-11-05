/**
 * verify-pages.mjs — crawls every authenticated route with a valid signed
 * session cookie and fails on HTTP >= 400 or Next error markers.
 * Usage: node --import ./scripts/lib/register-alias.mjs scripts/verify-pages.mjs
 */
process.env.SESSION_SECRET ??= "katalis-pos-demo-session-secret-do-not-use-in-production";
process.env.DATABASE_URL ??= "pglite://./.data/pglite";

const { createSessionToken } = await import("@/server/session");
const { connectDatabase } = await import("./lib/db.mjs");

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const db = await connectDatabase();

const users = {
  owner: "owner@katalispos.id",
  manager: "manager@katalispos.id",
  cashier: "kasir1@katalispos.id",
  warehouse: "gudang@katalispos.id",
};

const routesByRole = {
  owner: [
    "/admin",
    "/admin/audit",
    "/admin/settings",
    "/pos",
    "/pos/sync",
    "/shifts",
    "/transactions",
    "/products",
    "/inventory",
    "/inventory/opname",
    "/inventory/receiving",
    "/customers",
    "/promos",
    "/dss",
    "/dss/restock",
    "/dss/anomalies",
    "/dss/riwayat",
  ],
  manager: ["/admin", "/admin/audit", "/shifts", "/dss", "/promos"],
  cashier: ["/pos", "/pos/sync", "/shifts", "/transactions", "/customers"],
  warehouse: ["/inventory", "/inventory/receiving", "/inventory/opname", "/products"],
};

const detailRoutes = async () => {
  const order = await db.query("select id, receipt_number from sales_orders limit 1");
  const shift = await db.query("select id from pos_shifts limit 1");
  const product = await db.query("select id from products limit 1");
  const rows = [];
  if (order.rows[0]) {
    rows.push(`/transactions/${order.rows[0].id}`);
    rows.push(`/receipt/${order.rows[0].receipt_number}`);
  }
  if (shift.rows[0]) rows.push(`/shifts/${shift.rows[0].id}`, `/reports/shift/${shift.rows[0].id}`);
  if (product.rows[0]) rows.push(`/products/${product.rows[0].id}`);
  return rows;
};

const cookies = {};
for (const [role, email] of Object.entries(users)) {
  const row = (await db.query("select id, email, full_name, role from profiles where email=$1", [email])).rows[0];
  if (!row) throw new Error(`profil tidak ditemukan: ${email}`);
  cookies[role] = `${"katalis_session"}=${await createSessionToken({
    userId: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  })}`;
}

const extra = await detailRoutes();
const targets = [
  ...routesByRole.owner.map((path) => ({ role: "owner", path })),
  ...routesByRole.manager.map((path) => ({ role: "manager", path })),
  ...routesByRole.cashier.map((path) => ({ role: "cashier", path })),
  ...routesByRole.warehouse.map((path) => ({ role: "warehouse", path })),
  ...extra.map((path) => ({ role: "owner", path })),
  { role: "owner", path: "/transactions?status=VOIDED" },
  { role: "owner", path: "/products?q=gula" },
];

const rbacExpectations = [
  { role: "cashier", path: "/admin", expect: 307 },
  { role: "cashier", path: "/dss", expect: 307 },
  { role: "warehouse", path: "/pos", expect: 307 },
  { role: "manager", path: "/admin/settings", expect: 307 },
  { role: "anonymous", path: "/admin", expect: 307 },
];

let failed = 0;
let checked = 0;

for (const target of targets) {
  const response = await fetch(`${base}${target.path}`, {
    headers: { cookie: cookies[target.role] },
    redirect: "manual",
  });
  const body = response.status === 200 ? await response.text() : "";
  const bad =
    response.status >= 400 ||
    body.includes("Application error") ||
    body.includes("__next_error__") ||
    body.includes("Internal Server Error");
  checked += 1;
  if (bad) {
    failed += 1;
    console.log(`FAIL ${response.status} [${target.role}] ${target.path}`);
  } else {
    console.log(`ok   ${response.status} [${target.role}] ${target.path}`);
  }
}

for (const check of rbacExpectations) {
  const response = await fetch(`${base}${check.path}`, {
    headers: check.role === "anonymous" ? {} : { cookie: cookies[check.role] },
    redirect: "manual",
  });
  checked += 1;
  const allowed = response.status === check.expect;
  if (!allowed) {
    failed += 1;
    console.log(`FAIL RBAC ${response.status} (harap ${check.expect}) [${check.role}] ${check.path}`);
  } else {
    console.log(`ok   RBAC ${response.status} [${check.role}] ${check.path}`);
  }
}

// CSV exports: BOM + semicolon. fetch().text() strips the BOM on decode, so the
// check reads the raw first bytes instead.
for (const path of ["/api/export/sales", "/api/export/inventory", "/api/export/shifts"]) {
  const response = await fetch(`${base}${path}`, { headers: { cookie: cookies.owner } });
  const buffer = new Uint8Array(await response.arrayBuffer());
  const hasBom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
  checked += 1;
  const valid = response.status === 200 && hasBom && text.includes(";");
  if (!valid) {
    failed += 1;
    console.log(`FAIL CSV ${response.status} ${path} (BOM=${hasBom}, titik-koma=${text.includes(";")})`);
  } else {
    console.log(`ok   CSV ${response.status} ${path} (${text.split("\r\n").length} baris, BOM ok)`);
  }
}

await db.close();
console.log(`\n${checked - failed}/${checked} lulus`);
process.exit(failed ? 1 : 0);
