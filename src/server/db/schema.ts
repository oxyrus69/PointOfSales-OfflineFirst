import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*  Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "STORE_MANAGER",
  "CASHIER",
  "WAREHOUSE_STAFF",
]);

export const shiftStatusEnum = pgEnum("shift_status", [
  "OPEN",
  "CLOSED_MATCHED",
  "CLOSED_WITH_VARIANCE",
  "AUDITED",
]);

export const cashMovementTypeEnum = pgEnum("cash_movement_type", [
  "OPENING_FLOAT",
  "CASH_IN_MISC",
  "CASH_OUT_EXPENSE",
  "CASH_DROP_SAFE",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH",
  "QRIS",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "SPLIT_PAYMENT",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "COMPLETED",
  "VOIDED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "DIRECT_ONLINE",
  "SYNCED_FROM_OFFLINE",
  "SYNC_CONFLICT_RESOLVED",
]);

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "INITIAL_SEED",
  "PURCHASE_RECEIVE",
  "POS_SALE",
  "POS_VOID_RETURN",
  "OPNAME_ADJUSTMENT",
  "DAMAGED_WRITE_OFF",
]);

export const opnameStatusEnum = pgEnum("opname_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);

export const customerTierEnum = pgEnum("customer_tier", [
  "REGULAR",
  "SILVER",
  "GOLD",
  "VIP",
]);

export const discountTypeEnum = pgEnum("discount_type", ["PERCENTAGE", "FIXED_AMOUNT"]);

export const decisionCategoryEnum = pgEnum("decision_category", [
  "RESTOCK_URGENT",
  "DEAD_STOCK_CAPITAL",
  "MARGIN_EROSION",
  "CASHIER_RISK_ANOMALY",
]);

export const decisionStatusEnum = pgEnum("decision_status", [
  "NEW",
  "ACKNOWLEDGED",
  "ACTIONED",
  "DISMISSED",
]);

/* -------------------------------------------------------------------------- */
/*  Shared column helpers                                                      */
/* -------------------------------------------------------------------------- */

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/* -------------------------------------------------------------------------- */
/*  1. profiles                                                                */
/* -------------------------------------------------------------------------- */

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    supervisorPinHash: text("supervisor_pin_hash"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex("profiles_email_uq").on(t.email),
  }),
);

/* -------------------------------------------------------------------------- */
/*  2. categories                                                              */
/* -------------------------------------------------------------------------- */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => ({
    codeIdx: uniqueIndex("categories_code_uq").on(t.code),
  }),
);

/* -------------------------------------------------------------------------- */
/*  3. products                                                                */
/* -------------------------------------------------------------------------- */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    unit: text("unit").notNull().default("PCS"),
    costPrice: money("cost_price").notNull().default("0"),
    retailPrice: money("retail_price").notNull().default("0"),
    minMarginPct: pct("min_margin_pct").notNull().default("0"),
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(0),
    reorderQty: integer("reorder_qty").notNull().default(0),
    isTaxable: boolean("is_taxable").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    skuIdx: uniqueIndex("products_sku_uq").on(t.sku),
    barcodeIdx: uniqueIndex("products_barcode_uq").on(t.barcode),
    categoryIdx: index("products_category_idx").on(t.categoryId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  4. product_price_tiers                                                     */
/* -------------------------------------------------------------------------- */

export const productPriceTiers = pgTable(
  "product_price_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    minQty: integer("min_qty").notNull(),
    tierUnitPrice: money("tier_unit_price").notNull(),
    label: text("label").notNull(),
  },
  (t) => ({
    productQtyIdx: uniqueIndex("price_tiers_product_qty_uq").on(t.productId, t.minQty),
  }),
);

/* -------------------------------------------------------------------------- */
/*  5. customers                                                               */
/* -------------------------------------------------------------------------- */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberCode: text("member_code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    tier: customerTierEnum("tier").notNull().default("REGULAR"),
    discountPct: pct("discount_pct").notNull().default("0"),
    pointsBalance: integer("points_balance").notNull().default(0),
    totalSpent: money("total_spent").notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => ({
    memberCodeIdx: uniqueIndex("customers_member_code_uq").on(t.memberCode),
  }),
);

/* -------------------------------------------------------------------------- */
/*  6. promos                                                                  */
/* -------------------------------------------------------------------------- */

export const promos = pgTable(
  "promos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    discountType: discountTypeEnum("discount_type").notNull(),
    discountValue: money("discount_value").notNull(),
    minSubtotal: money("min_subtotal").notNull().default("0"),
    maxDiscountCap: money("max_discount_cap").notNull().default("0"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    codeIdx: uniqueIndex("promos_code_uq").on(t.code),
  }),
);

/* -------------------------------------------------------------------------- */
/*  7. pos_shifts                                                              */
/* -------------------------------------------------------------------------- */

export const posShifts = pgTable(
  "pos_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftNumber: text("shift_number").notNull(),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => profiles.id),
    terminalId: text("terminal_id").notNull().default("KASIR-01"),
    status: shiftStatusEnum("status").notNull().default("OPEN"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    openingCash: money("opening_cash").notNull().default("0"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expectedCashSystem: money("expected_cash_system"),
    actualCashCounted: money("actual_cash_counted"),
    cashVariance: money("cash_variance"),
    totalSalesGross: money("total_sales_gross").notNull().default("0"),
    totalDiscounts: money("total_discounts").notNull().default("0"),
    totalTax: money("total_tax").notNull().default("0"),
    totalNetSales: money("total_net_sales").notNull().default("0"),
    totalCashSales: money("total_cash_sales").notNull().default("0"),
    totalNonCashSales: money("total_non_cash_sales").notNull().default("0"),
    totalVoidAmount: money("total_void_amount").notNull().default("0"),
    closingNotes: text("closing_notes"),
    auditedBy: uuid("audited_by").references(() => profiles.id),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    shiftNumberIdx: uniqueIndex("pos_shifts_number_uq").on(t.shiftNumber),
    cashierIdx: index("pos_shifts_cashier_idx").on(t.cashierId),
    statusIdx: index("pos_shifts_status_idx").on(t.status),
    openedIdx: index("pos_shifts_opened_idx").on(t.openedAt),
  }),
);

/* -------------------------------------------------------------------------- */
/*  8. cash_drawer_movements                                                   */
/* -------------------------------------------------------------------------- */

export const cashDrawerMovements = pgTable(
  "cash_drawer_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => posShifts.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    authorizedBy: uuid("authorized_by").references(() => profiles.id),
    movementType: cashMovementTypeEnum("movement_type").notNull(),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    createdOfflineAt: timestamp("created_offline_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    shiftIdx: index("cash_movements_shift_idx").on(t.shiftId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  9. sales_orders                                                            */
/* -------------------------------------------------------------------------- */

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNumber: text("receipt_number").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    shiftId: uuid("shift_id").references(() => posShifts.id),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => profiles.id),
    customerId: uuid("customer_id").references(() => customers.id),
    promoId: uuid("promo_id").references(() => promos.id),
    status: orderStatusEnum("status").notNull().default("COMPLETED"),
    syncMode: syncStatusEnum("sync_mode").notNull().default("DIRECT_ONLINE"),
    createdOfflineAt: timestamp("created_offline_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    subtotal: money("subtotal").notNull().default("0"),
    tierDiscountTotal: money("tier_discount_total").notNull().default("0"),
    memberDiscountAmount: money("member_discount_amount").notNull().default("0"),
    promoDiscountAmount: money("promo_discount_amount").notNull().default("0"),
    manualDiscountAmount: money("manual_discount_amount").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    roundingAdjustment: money("rounding_adjustment").notNull().default("0"),
    grandTotal: money("grand_total").notNull().default("0"),
    totalCogs: money("total_cogs").notNull().default("0"),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("CASH"),
    cashReceived: money("cash_received").notNull().default("0"),
    changeGiven: money("change_given").notNull().default("0"),
    paymentReference: text("payment_reference"),
    receiptSignature: text("receipt_signature"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBySupervisor: uuid("voided_by_supervisor").references(() => profiles.id),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => ({
    receiptIdx: uniqueIndex("sales_orders_receipt_uq").on(t.receiptNumber),
    clientReqIdx: uniqueIndex("sales_orders_client_request_uq").on(t.clientRequestId),
    shiftIdx: index("sales_orders_shift_idx").on(t.shiftId),
    createdIdx: index("sales_orders_created_idx").on(t.createdAt),
    statusIdx: index("sales_orders_status_idx").on(t.status),
  }),
);

/* -------------------------------------------------------------------------- */
/*  10. sales_order_items                                                      */
/* -------------------------------------------------------------------------- */

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    skuSnapshot: text("sku_snapshot").notNull(),
    qty: integer("qty").notNull(),
    baseUnitPrice: money("base_unit_price").notNull(),
    appliedUnitPrice: money("applied_unit_price").notNull(),
    tierLabelApplied: text("tier_label_applied"),
    unitCogsSnapshot: money("unit_cogs_snapshot").notNull().default("0"),
    lineSubtotal: money("line_subtotal").notNull(),
    refundedQty: integer("refunded_qty").notNull().default(0),
  },
  (t) => ({
    orderIdx: index("sales_order_items_order_idx").on(t.orderId),
    productIdx: index("sales_order_items_product_idx").on(t.productId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  11. sales_payments                                                         */
/* -------------------------------------------------------------------------- */

export const salesPayments = pgTable(
  "sales_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    method: paymentMethodEnum("method").notNull(),
    amount: money("amount").notNull(),
    referenceNo: text("reference_no"),
  },
  (t) => ({
    orderIdx: index("sales_payments_order_idx").on(t.orderId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  12. returns_refunds                                                        */
/* -------------------------------------------------------------------------- */

export const returnsRefunds = pgTable(
  "returns_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnNumber: text("return_number").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    shiftId: uuid("shift_id").references(() => posShifts.id),
    processedBy: uuid("processed_by")
      .notNull()
      .references(() => profiles.id),
    authorizedBySupervisor: uuid("authorized_by_supervisor").references(() => profiles.id),
    refundAmount: money("refund_amount").notNull(),
    restockItems: boolean("restock_items").notNull().default(true),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    returnNumberIdx: uniqueIndex("returns_refunds_number_uq").on(t.returnNumber),
  }),
);

/* -------------------------------------------------------------------------- */
/*  13. suppliers / purchase_receipts / purchase_receipt_items                 */
/* -------------------------------------------------------------------------- */

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    leadTimeDays: integer("lead_time_days").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    codeIdx: uniqueIndex("suppliers_code_uq").on(t.code),
  }),
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNumber: text("receipt_number").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => profiles.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
  },
  (t) => ({
    receiptNumberIdx: uniqueIndex("purchase_receipts_number_uq").on(t.receiptNumber),
  }),
);

export const purchaseReceiptItems = pgTable("purchase_receipt_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => purchaseReceipts.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  qty: integer("qty").notNull(),
  unitCost: money("unit_cost").notNull(),
  lineTotal: money("line_total").notNull(),
});

/* -------------------------------------------------------------------------- */
/*  14. stock_opnames / stock_opname_items                                     */
/* -------------------------------------------------------------------------- */

export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opnameNumber: text("opname_number").notNull(),
    status: opnameStatusEnum("status").notNull().default("DRAFT"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    notes: text("notes"),
    totalVarianceValue: money("total_variance_value").notNull().default("0"),
    createdAt: createdAt(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => ({
    numberIdx: uniqueIndex("stock_opnames_number_uq").on(t.opnameNumber),
  }),
);

export const stockOpnameItems = pgTable("stock_opname_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  opnameId: uuid("opname_id")
    .notNull()
    .references(() => stockOpnames.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  systemQtySnapshot: integer("system_qty_snapshot").notNull(),
  physicalQtyCounted: integer("physical_qty_counted").notNull(),
  varianceQty: integer("variance_qty").notNull(),
  varianceValueIdr: money("variance_value_idr").notNull(),
});

/* -------------------------------------------------------------------------- */
/*  15. stock_ledgers                                                          */
/* -------------------------------------------------------------------------- */

export const stockLedgers = pgTable(
  "stock_ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    movementType: stockMovementTypeEnum("movement_type").notNull(),
    referenceId: text("reference_id").notNull(),
    qtyChange: integer("qty_change").notNull(),
    qtyBefore: integer("qty_before").notNull(),
    qtyAfter: integer("qty_after").notNull(),
    unitCostAtMovement: money("unit_cost_at_movement").notNull().default("0"),
    actorId: uuid("actor_id").references(() => profiles.id),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => ({
    productIdx: index("stock_ledgers_product_idx").on(t.productId),
    createdIdx: index("stock_ledgers_created_idx").on(t.createdAt),
  }),
);

/* -------------------------------------------------------------------------- */
/*  16. offline_sync_conflicts                                                 */
/* -------------------------------------------------------------------------- */

export const offlineSyncConflicts = pgTable(
  "offline_sync_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => salesOrders.id),
    productId: uuid("product_id").references(() => products.id),
    clientRequestId: text("client_request_id").notNull(),
    conflictType: text("conflict_type").notNull().default("NEGATIVE_STOCK"),
    serverQtyBefore: integer("server_qty_before").notNull(),
    offlineQtySold: integer("offline_qty_sold").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: uuid("resolved_by").references(() => profiles.id),
    resolutionNotes: text("resolution_notes"),
    createdAt: createdAt(),
  },
  (t) => ({
    resolvedIdx: index("offline_conflicts_resolved_idx").on(t.resolved),
  }),
);

/* -------------------------------------------------------------------------- */
/*  17. decision_rules / decision_logs / audit_logs / app_settings             */
/*      document_sequences / idempotency_keys                                  */
/* -------------------------------------------------------------------------- */

export const decisionRules = pgTable(
  "decision_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: decisionCategoryEnum("code").notNull(),
    name: text("name").notNull(),
    thresholdValue: numeric("threshold_value", { precision: 14, scale: 2 }).notNull().default("0"),
    windowDays: integer("window_days").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
  },
  (t) => ({
    codeIdx: uniqueIndex("decision_rules_code_uq").on(t.code),
  }),
);

export const decisionLogs = pgTable(
  "decision_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleCode: decisionCategoryEnum("rule_code").notNull(),
    subjectId: text("subject_id").notNull(),
    subjectLabel: text("subject_label").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: decisionStatusEnum("status").notNull().default("NEW"),
    actedBy: uuid("acted_by").references(() => profiles.id),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    ruleIdx: index("decision_logs_rule_idx").on(t.ruleCode),
    createdIdx: index("decision_logs_created_idx").on(t.createdAt),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id),
    authorizedById: uuid("authorized_by_id").references(() => profiles.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    severity: text("severity").notNull().default("INFO"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => ({
    actionIdx: index("audit_logs_action_idx").on(t.action),
    createdIdx: index("audit_logs_created_idx").on(t.createdAt),
  }),
);

export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    group: text("group").notNull().default("general"),
    label: text("label").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => profiles.id),
  },
);

export const documentSequences = pgTable("document_sequences", {
  key: text("key").primaryKey(),
  prefix: text("prefix").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    scope: text("scope").notNull(),
    responsePayload: jsonb("response_payload").notNull().default({}),
    actorId: uuid("actor_id").references(() => profiles.id),
    createdAt: createdAt(),
  },
  (t) => ({
    scopeIdx: index("idempotency_scope_idx").on(t.scope),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type PriceTier = typeof productPriceTiers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Promo = typeof promos.$inferSelect;
export type PosShift = typeof posShifts.$inferSelect;
export type CashMovement = typeof cashDrawerMovements.$inferSelect;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type SalesOrderItem = typeof salesOrderItems.$inferSelect;
export type SalesPayment = typeof salesPayments.$inferSelect;
export type StockLedgerRow = typeof stockLedgers.$inferSelect;
export type SyncConflict = typeof offlineSyncConflicts.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type ShiftStatus = (typeof shiftStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type SyncMode = (typeof syncStatusEnum.enumValues)[number];
export type StockMovementType = (typeof stockMovementTypeEnum.enumValues)[number];
export type OpnameStatus = (typeof opnameStatusEnum.enumValues)[number];
export type DecisionCategory = (typeof decisionCategoryEnum.enumValues)[number];
