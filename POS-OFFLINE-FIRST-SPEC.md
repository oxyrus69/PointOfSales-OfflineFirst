# Katalis POS — Offline-First Point of Sale, Shift Reconciliation & Retail DSS

Dokumen ini adalah spesifikasi teknis menyeluruh (*blueprint* & *agent instructions*) untuk membangun sistem Point of Sale (POS) ritel modern berkecepatan tinggi dengan arsitektur **Offline-First (IndexedDB + Background Sync)**, navigasi penuh via pintasan *keyboard* & pemindai *barcode*, manajemen laci kasir (*blind shift reconciliation*), harga bertingkat (eceran/grosir), HPP rata-rata tertimbang, serta **Sistem Pendukung Keputusan (DSS)** ritel.

Dirancang dengan standar produksi (*production-grade*) termasuk dukungan **Basis Data Ganda (PGlite + PostgreSQL Server)** dan inisialisasi Git sejak awal agar dapat dieksekusi secara mandiri dari hulu ke hilir oleh *coding agent*.

---

## 1. Identitas Proyek & Tech Stack

* **Nama Sistem:** Katalis POS (Offline-First Retail POS, Inventory & Shift Management System)
* **Domain Masalah:** Toko ritel, minimarket, distributor grosir-eceran, dan gerai F&B yang membutuhkan terminal kasir tanpa jeda (*zero-latency*) yang **tetap bisa bertransaksi penuh saat internet putus**, mencegah kebocoran uang tunai lewat rekonsiliasi laci kasir tertutup (*blind drop*), mencegah kecurangan *void*/diskon lewat otorisasi PIN Supervisor, dan menjaga ketersediaan stok barang.
* **Tech Stack Wajib:**
  * **Framework:** Next.js 15 (App Router, React 19, *Server Components*, *Server Actions*, & Route Handlers) + TypeScript ketat (*strict mode*).
  * **Database Server & ORM:** Drizzle ORM dengan **Dual-Mode Database Adapter** (`@electric-sql/pglite` untuk mode demo/lokal instan tanpa setup, dan `postgres` / PostgreSQL Server untuk mode produksi).
  * **Offline-First Client Engine:** Browser **IndexedDB** (dibungkus secara *type-safe* di `src/lib/offlineDb.ts`) untuk menyimpan *snapshot* katalog produk, keranjang tertahan (*held bills*), serta antrean transaksi keluar (*outbox transaction queue*) saat luring (*offline*), ditambah **PWA Web App Manifest & Service Worker** untuk *caching* aset antarmuka.
  * **Styling & UI:** Tailwind CSS, komponen dialog/modal aksesibel, `lucide-react`, `@tanstack/react-table`, dan `recharts` untuk analitik penjualan.
  * **Keamanan & Kriptografi:** Node.js `crypto` (`HMAC-SHA256` / `scrypt`) untuk verifikasi PIN Otorisasi Supervisor, sesi *cookie* HTTP-only, dan tanda tangan integritas struk.

---

## 2. Peta Modul & Rute Sistem (`src/app`)

| Modul | Rute Halaman (App Router) | Service & Mesin Inti (`src/server` & `src/lib`) | Status Target |
| :--- | :--- | :--- | :--- |
| **Dasbor Manajer Ritel** | `/admin` | `analytics.ts`, `dssEngine.ts` | Wajib Selesai |
| **Terminal Kasir (Offline-First)** | `/pos` | `posMath.ts`, `offlineDb.ts`, `posSyncEngine.ts` | Wajib Selesai |
| **Pusat Sinkronisasi & Konflik** | `/pos/sync` | `posSyncEngine.ts` | Wajib Selesai |
| **Manajemen Shift & Laci Kas** | `/shifts`, `/shifts/[id]` | `shiftEngine.ts` | Wajib Selesai |
| **Riwayat Transaksi & Retur/Void** | `/transactions`, `/transactions/[id]` | `salesEngine.ts`, `supervisorAuth.ts` | Wajib Selesai |
| **Katalog Produk & Harga Grosir** | `/products`, `/products/[id]` | `products.ts`, `posMath.ts` | Wajib Selesai |
| **Inventaris, HPP & Kartu Stok** | `/inventory`, `/inventory/opname`, `/inventory/receiving` | `inventoryEngine.ts` | Wajib Selesai |
| **Pelanggan, Member & Promo** | `/customers`, `/promos` | `customers.ts`, `promos.ts` | Wajib Selesai |
| **DSS (Keputusan Ritel & Kas)** | `/dss`, `/dss/restock`, `/dss/anomalies`, `/dss/riwayat` | `dssEngine.ts` | Wajib Selesai |
| **Jejak Audit & Pengaturan Toko** | `/admin/audit`, `/admin/settings` | `audit.ts`, `settings.ts` | Wajib Selesai |
| **API Sinkronisasi Offline** | `/api/pos/catalog-snapshot`, `/api/pos/sync-batch` | `posSyncEngine.ts` | Wajib Selesai |
| **Ekspor CSV (Excel Indonesia)** | `/api/export/sales`, `/api/export/inventory`, `/api/export/shifts` | `exportHandlers.ts` | Wajib Selesai |
| **Cetak Struk Termal & Z-Report** | `(print)/receipt/[id]`, `(print)/reports/shift/[id]` | — | Wajib Selesai |

---

## 3. Matriks RBAC (Role-Based Access Control)

Penegakan akses dilakukan di `src/middleware.ts` (*longest-prefix match*) dan di setiap *Server Action* / *Route Handler* menggunakan `requireRole()` di `src/server/rbac.ts`.

| Peran | Halaman Pendaratan (`ROLE_HOME`) | Hak Akses Utama |
| :--- | :--- | :--- |
| `SUPER_ADMIN` | `/admin` | Akses penuh ke seluruh modul, pengaturan pajak/toko, manajemen staf & PIN Supervisor, katalog, inventaris, keuangan shift, DSS, dan jejak audit. |
| `STORE_MANAGER` | `/admin` | Mengelola produk, harga bertingkat, promo, penerimaan barang, persetujuan *stock opname*, rekonsiliasi selisih shift kasir, otorisasi PIN untuk *void*/retur/diskon manual, dan DSS. |
| `CASHIER` | `/pos` | Membuka/menutup shift kasir sendiri, menjalankan terminal `/pos` (online maupun offline), sinkronisasi antrean `/pos/sync`, melihat transaksi shift berjalan; **dilarang** mengubah harga master, melihat saldo sistem sebelum tutup shift (*blind drop*), atau melakukan *void* tanpa PIN Supervisor. |
| `WAREHOUSE_STAFF` | `/inventory` | Mengelola stok masuk (*receiving* dari supplier), menjalankan perhitungan fisik *stock opname*, dan melihat kartu stok (`stock_ledgers`); **tanpa akses** ke terminal kasir dan laporan uang. |

---

## 4. Skema Database (`src/server/db/schema.ts`)

Gunakan Drizzle ORM. Seluruh nominal uang disimpan sebagai `numeric(14,2)` dan dibulatkan ke rupiah penuh pada transaksi IDR.

### 4.1. Enum Utama
* `user_role`: `'SUPER_ADMIN' | 'STORE_MANAGER' | 'CASHIER' | 'WAREHOUSE_STAFF'`
* `shift_status`: `'OPEN' | 'CLOSED_MATCHED' | 'CLOSED_WITH_VARIANCE' | 'AUDITED'`
* `cash_movement_type`: `'OPENING_FLOAT' | 'CASH_IN_MISC' | 'CASH_OUT_EXPENSE' | 'CASH_DROP_SAFE'`
* `payment_method`: `'CASH' | 'QRIS' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'SPLIT_PAYMENT'`
* `order_status`: `'COMPLETED' | 'VOIDED' | 'PARTIALLY_REFUNDED' | 'REFUNDED'`
* `sync_status`: `'DIRECT_ONLINE' | 'SYNCED_FROM_OFFLINE' | 'SYNC_CONFLICT_RESOLVED'`
* `stock_movement_type`: `'INITIAL_SEED' | 'PURCHASE_RECEIVE' | 'POS_SALE' | 'POS_VOID_RETURN' | 'OPNAME_ADJUSTMENT' | 'DAMAGED_WRITE_OFF'`
* `opname_status`: `'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'`

### 4.2. Tabel Inti (Minimal 18 Tabel)

1. **`profiles`**:
   * `id` (UUID PK), `email` (unique), `full_name`, `role` (`user_role`), `password_hash`, `supervisor_pin_hash` (nullable, khusus `SUPER_ADMIN` dan `STORE_MANAGER` untuk otorisasi cepat di layar kasir), `is_active` (boolean), `created_at`.
2. **`categories`**: `id` (UUID PK), `code` (unique), `name`, `description`.
3. **`products`**:
   * `id` (UUID PK), `sku` (unique), `barcode` (unique, indeks cepat untuk pemindai), `name`, `category_id` (FK `categories.id`), `unit` (misal: `'PCS' | 'BOX' | 'PACK'`).
   * `cost_price` (`numeric(14,2)` — HPP rata-rata tertimbang saat ini), `retail_price` (`numeric(14,2)` — harga jual eceran dasar), `min_margin_pct` (`numeric(5,2)`).
   * `stock_on_hand` (integer), `reorder_point` (integer), `reorder_qty` (integer), `is_taxable` (boolean), `is_active` (boolean), `version` (integer, *optimistic locking*), `updated_at`.
4. **`product_price_tiers`** (Harga Bertingkat / Grosir Otomatis):
   * `id` (UUID PK), `product_id` (FK `products.id`), `min_qty` (integer, misal $\ge 6$ atau $\ge 12$), `tier_unit_price` (`numeric(14,2)`), `label` (misal: `"Grosir Setengah Lusin"`, `"Harga Karton"`).
5. **`customers`** (Member & Pelanggan):
   * `id` (UUID PK), `member_code` (unique), `name`, `phone`, `tier` (`'REGULAR' | 'SILVER' | 'GOLD' | 'VIP'`), `discount_pct` (`numeric(5,2)`), `points_balance` (integer), `total_spent` (`numeric(14,2)`), `created_at`.
6. **`promos`**:
   * `id` (UUID PK), `code` (unique), `name`, `discount_type` (`'PERCENTAGE' | 'FIXED_AMOUNT'`), `discount_value` (`numeric(14,2)`), `min_subtotal` (`numeric(14,2)`), `max_discount_cap` (`numeric(14,2)`), `valid_from`, `valid_until`, `is_active` (boolean).
7. **`pos_shifts`** (Sesi Shift Kasir & Rekonsiliasi Laci):
   * `id` (UUID PK), `shift_number` (unique, `SHF-YYYYMM-XXXX`), `cashier_id` (FK `profiles.id`), `terminal_id` (text, misal `"KASIR-01"`), `status` (`shift_status`).
   * `opened_at` (timestamp), `opening_cash` (`numeric(14,2)` — modal uang kembalian awal).
   * `closed_at` (timestamp, nullable), `expected_cash_system` (`numeric(14,2)` — dihitung sistem saat tutup shift), `actual_cash_counted` (`numeric(14,2)` — diinput kasir secara *blind count*), `cash_variance` (`numeric(14,2)` — selisih $\text{actual} - \text{expected}$).
   * `total_sales_gross`, `total_discounts`, `total_tax`, `total_net_sales`, `total_cash_sales`, `total_non_cash_sales`, `total_void_amount` (`numeric(14,2)`).
   * `closing_notes` (text), `audited_by` (FK `profiles.id`, nullable), `version` (integer).
8. **`cash_drawer_movements`** (Kas Masuk / Kas Keluar Operasional Laci):
   * `id` (UUID PK), `shift_id` (FK `pos_shifts.id`), `actor_id` (FK `profiles.id`), `authorized_by` (FK `profiles.id`, nullable), `movement_type` (`cash_movement_type`), `amount` (`numeric(14,2)`), `reason` (text), `created_at`.
9. **`sales_orders`** (Struk Penjualan POS):
   * `id` (UUID PK — boleh dibuat di klien saat *offline* untuk menjaga idempotensi), `receipt_number` (unique, `INV-YYYYMMDD-XXXX` atau nomor luring `OFF-TERMINAL-TIMESTAMP` yang dipetakan), `client_request_id` (unique, kunci idempoten mutlak).
   * `shift_id` (FK `pos_shifts.id`), `cashier_id` (FK `profiles.id`), `customer_id` (FK `customers.id`, nullable), `promo_id` (FK `promos.id`, nullable).
   * `status` (`order_status`), `sync_mode` (`sync_status`), `created_offline_at` (timestamp), `synced_at` (timestamp).
   * `subtotal`, `tier_discount_total`, `member_discount_amount`, `promo_discount_amount`, `manual_discount_amount`, `tax_amount`, `rounding_adjustment`, `grand_total`, `total_cogs` (`numeric(14,2)`).
   * `payment_method` (`payment_method`), `cash_received`, `change_given` (`numeric(14,2)`), `payment_reference` (text, untuk QRIS/Kartu).
   * `voided_at`, `voided_by_supervisor` (FK `profiles.id`), `void_reason` (text).
10. **`sales_order_items`**:
    * `id` (UUID PK), `order_id` (FK `sales_orders.id`), `product_id` (FK `products.id`), `product_name_snapshot`, `sku_snapshot`.
    * `qty` (integer), `base_unit_price` (`numeric(14,2)`), `applied_unit_price` (`numeric(14,2)` — setelah harga grosir), `tier_label_applied` (text, nullable), `unit_cogs_snapshot` (`numeric(14,2)` — HPP saat barang terjual), `line_subtotal` (`numeric(14,2)`), `refunded_qty` (integer, default $0$).
11. **`sales_payments`** (Mendukung *Split Payment* Tunai + QRIS/Debit):
    * `id` (UUID PK), `order_id` (FK `sales_orders.id`), `method` (`'CASH' | 'QRIS' | 'DEBIT_CARD' | 'CREDIT_CARD'`), `amount` (`numeric(14,2)`), `reference_no` (text).
12. **`returns_refunds`**:
    * `id` (UUID PK), `return_number` (unique), `order_id` (FK `sales_orders.id`), `shift_id` (FK `pos_shifts.id`), `processed_by` (FK `profiles.id`), `authorized_by_supervisor` (FK `profiles.id`), `refund_amount` (`numeric(14,2)`), `restock_items` (boolean), `reason` (text), `created_at`.
13. **`suppliers`**, **`purchase_receipts`**, & **`purchase_receipt_items`** (Penerimaan Barang & Perhitungan HPP):
    * Mencatat pembelian stok dari pemasok beserta harga beli baru untuk memperbarui HPP rata-rata tertimbang.
14. **`stock_opnames`** & **`stock_opname_items`**:
    * Sesi penghitungan fisik gudang/toko: menyimpan `system_qty_snapshot`, `physical_qty_counted`, `variance_qty`, `variance_value_idr`, dan alur persetujuan manajer.
15. **`stock_ledgers`** (Kartu Stok Tak Terbantahkan / *Immutable Inventory Ledger*):
    * `id` (UUID PK), `product_id` (FK `products.id`), `movement_type` (`stock_movement_type`), `reference_id` (text — nomor struk/PO/opname), `qty_change` (integer, bertanda $+$ atau $-$), `qty_before` (integer), `qty_after` (integer), `unit_cost_at_movement` (`numeric(14,2)`), `actor_id` (FK `profiles.id`), `notes`, `created_at`.
16. **`offline_sync_conflicts`**:
    * Mencatat kasus ketika transaksi yang terjadi saat *offline* disinkronkan ke server namun stok fisik di server ternyata lebih kecil dari jumlah yang terjual saat luring (*negative stock anomaly*), sehingga manajer dapat melakukan rekonsiliasi stok tanpa menolak uang yang sudah diterima kasir.
17. **`decision_rules`**, **`decision_logs`**, **`audit_logs`**, **`app_settings`**, **`document_sequences`**, **`idempotency_keys`**.

---

## 5. Spesifikasi Mesin Inti (*Core Engines*)

### 5.1. Mesin Matematika Harga, Grosir & Pajak Murni (`src/lib/posMath.ts`)
Modul ini **bebas dependensi server** (murni TypeScript) sehingga dipakai secara identik oleh **Terminal Kasir Offline (di Browser)** dan **Validator Transaksi (di Server)**:

1. **Resolusi Harga Bertingkat (`resolveTierPricePure`)**:
   * Untuk setiap item di keranjang dengan kuantitas $q$, pilih `tier_unit_price` dari `product_price_tiers` dengan syarat $\text{min\_qty} \le q$ yang memberikan harga satuan paling rendah bagi pelanggan.
   * Penghematan grosir per baris:
     $$\text{TierSaving} = (\text{BaseRetailPrice} - \text{AppliedUnitPrice}) \times q$$
2. **Perhitungan Keranjang, Diskon Berlapis, Pajak & Pembulatan (`calculateCartTotalsPure`)**:
   * $\text{Subtotal} = \sum (\text{AppliedUnitPrice}_i \times q_i)$
   * Diskon Member ($\text{MemberDisc}$), Diskon Voucher Promo ($\text{PromoDisc}$ dengan plafon `max_discount_cap`), dan Diskon Manual ($\text{ManualDisc}$).
   * Dasar Pengenaan Pajak (DPP) untuk item kena pajak (`is_taxable = true`) dikurangi porsi diskon secara proporsional.
   * $\text{TaxAmount} = \text{round}(\text{TaxableBase} \times \frac{\text{taxRatePct}}{100})$ (default PPN $11\%$, dapat diatur inklusif atau eksklusif di pengaturan toko).
   * **Pembulatan Tunai Rupiah (`computeCashRoundingPure`)**: Jika metode pembayaran adalah `CASH`, bulatkan ke kelipatan $\text{Rp } 100$ terdekat (jika ada sen/pecahan ganjil akibat persentase diskon) dan catat selisihnya di `rounding_adjustment`.
3. **Rumus HPP Rata-Rata Tertimbang (`computeWeightedAverageCogsPure`)**:
   * Saat menerima barang baru (`PURCHASE_RECEIVE`) sejumlah $q_{\text{new}}$ dengan harga beli $c_{\text{new}}$ pada stok lama $q_{\text{old}}$ (jika $q_{\text{old}} < 0$, anggap $q_{\text{old}} = 0$ untuk perhitungan bobot) dan HPP lama $c_{\text{old}}$:
     $$\text{HPP}_{\text{baru}} = \text{round}\left(\frac{(q_{\text{old}} \times c_{\text{old}}) + (q_{\text{new}} \times c_{\text{new}})}{q_{\text{old}} + q_{\text{new}}}\right)$$

### 5.2. Mesin Offline-First & Sinkronisasi (`src/lib/offlineDb.ts` & `src/server/services/posSyncEngine.ts`)
1. **Penyimpanan IndexedDB di Browser (`offlineDb.ts`)**:
   * Membuka basis data IndexedDB bernama `katalis_pos_offline_v1` dengan 4 *object store*:
     * `catalog_cache`: menyimpan produk, *barcode*, stok terakhir, dan aturan harga grosir (`product_price_tiers`) serta daftar member/promo aktif.
     * `held_bills`: menyimpan transaksi pelanggan yang sedang ditahan sementara (`Hold Bill / Parkir Struk`) agar tidak hilang meskipun tab *browser* ditutup atau listrik mati.
     * `tx_outbox`: menyimpan antrean transaksi selesai (`sales_orders` lengkap dengan `client_request_id` UUID, waktu transaksi, dan detail item) yang dibuat ketika status jaringan `offline` atau ketika server gagal merespons.
     * `sync_history`: riwayat sinkronisasi lokal di perangkat kasir.
2. **Simulasi Mode Offline Satu Klik di UI (`/pos`)**:
   * Sediakan tombol sakelar **"Simulasi Putus Jaringan (Offline Mode)"** di bilah atas terminal `/pos` (selain deteksi otomatis `navigator.onLine`).
   * Saat mode *Offline* aktif: pencarian *barcode*/produk, perhitungan grosir, penahanan struk (*Hold Bill*), pembayaran, dan cetak struk termal berjalan **100% dari IndexedDB tanpa satu pun panggilan jaringan (`0ms` server latency)**, dan transaksi masuk ke `tx_outbox` dengan lencana jumlah antrean menyala.
3. **Sinkronisasi Batch Idempoten (`POST /api/pos/sync-batch` & `syncOfflineBatchAction`)**:
   * Saat jaringan kembali terhubung (atau tombol **"Sinkronkan Sekarang"** ditekan), klien mengirim isi `tx_outbox` ke server.
   * Server memproses setiap transaksi di dalam transaksi database:
     * Memeriksa `client_request_id` di `idempotency_keys` / `sales_orders` — jika sudah pernah masuk, kembalikan status `ALREADY_SYNCED` (aman diulang berkali-kali).
     * Menghitung ulang total menggunakan `calculateCartTotalsPure` di server untuk memverifikasi integritas angka.
     * Memotong `stock_on_hand` dan menulis `stock_ledgers`.
     * **Resolusi Konflik Stok Offline:** Jika selama kasir *offline* stok produk habis sehingga pengurangan membuat `stock_on_hand < 0`, **tetap terima transaksi penjualan tersebut** (karena barang fisik dan uang sudah berpindah tangan di kasir), namun otomatis tulis baris peringatan ke tabel `offline_sync_conflicts` agar Manajer Toko dapat meninjau selisih stok fisik di `/pos/sync` dan `/dss`.

### 5.3. Mesin Shift Kasir & Rekonsiliasi Laci Tertutup (`src/server/services/shiftEngine.ts`)
1. **Buka Shift (`openShiftAction`)**: Kasir wajib memiliki 1 shift berstatus `OPEN` sebelum dapat menekan tombol bayar di `/pos`. Mencatat `opening_cash` (modal awal laci) dan menulis entri `OPENING_FLOAT` di `cash_drawer_movements`.
2. **Kas Masuk / Keluar (`recordCashMovementAction`)**: Mencatat pengambilan uang kecil dari laci (misal: beli es batu, plastik, atau setoran tengah hari ke brankas `CASH_DROP_SAFE`). Pengeluaran di atas ambang batas wajib menyertakan otorisasi PIN Supervisor.
3. **Tutup Shift dengan *Blind Drop* (`closeShiftBlindAction`)**:
   * Saat kasir membuka dialog Tutup Shift, antarmuka **dilarang menampilkan angka `expected_cash_system`** (uang tunai yang seharusnya ada di laci menurut sistem) agar kasir tidak sekadar menyamakan angka tanpa menghitung uang fisik.
   * Kasir memasukkan jumlah uang kertas/logam fisik yang dihitung (`actual_cash_counted`).
   * Server menghitung:
     $$\text{ExpectedCash} = \text{OpeningCash} + \text{TotalCashSales} - \text{TotalCashRefunds} + \text{CashInMisc} - \text{CashOutExpense} - \text{CashDropSafe}$$
     $$\text{CashVariance} = \text{ActualCashCounted} - \text{ExpectedCash}$$
   * Jika $\text{CashVariance} = 0$, status shift menjadi `CLOSED_MATCHED`. Jika $\text{CashVariance} \neq 0$, status menjadi `CLOSED_WITH_VARIANCE` dan memicu catatan audit serta peringatan di DSS jika melewati toleransi.

### 5.4. Mesin Otorisasi PIN Supervisor (`src/server/services/supervisorAuth.ts`)
* Aksi sensitif di kasir—yaitu: (1) *Void* struk lunas, (2) Retur/Refund barang, (3) Memberikan diskon manual melebihi batas kasir (default $> 5\%$), dan (4) Kas keluar laci di atas $\text{Rp } 100.000$—wajib memunculkan modal **Otorisasi PIN Supervisor (6 digit)**.
* Server memverifikasi PIN terhadap `supervisor_pin_hash` milik pengguna berperan `SUPER_ADMIN` atau `STORE_MANAGER`, mencatat siapa supervisor yang mengizinkan di kolom `authorized_by`, dan menulis jejak audit.

### 5.5. Mesin Pendukung Keputusan Ritel / DSS (`src/server/services/dssEngine.ts`)
Semua rekomendasi dihitung *on-the-fly* melalui agregasi SQL saat halaman `/dss` dibuka:
1. **Prediksi Kehabisan Stok & Reorder Point (`RESTOCK_URGENT`)**:
   * Menghitung laju penjualan harian 30 hari terakhir ($v_{30}$). Jika $\text{stock\_on\_hand} \le \text{reorder\_point}$ atau estimasi hari stok tersisa $\frac{\text{stock\_on\_hand}}{v_{30}} \le \text{leadTimeDays}$ (default $5$ hari), sarankan pemesanan ulang beserta estimasi biaya modal pembelian.
2. **Deteksi Modal Tertahan / *Dead Stock* (`DEAD_STOCK_CAPITAL`)**:
   * Produk dengan penjualan $< 2$ unit dalam 30 hari terakhir namun memiliki nilai modal mengendap ($\text{stock\_on\_hand} \times \text{cost\_price} \ge \text{Rp } 1.000.000$) $\to$ rekomendasikan bundel promo atau diskon cuci gudang.
3. **Erosi Margin Harga Jual (`MARGIN_EROSION`)**:
   * Produk yang akibat kenaikan harga beli supplier terbaru memiliki margin kotor $\frac{\text{retail\_price} - \text{cost\_price}}{\text{retail\_price}} \times 100\% < \text{min\_margin\_pct}$ $\to$ tampilkan rekomendasi penyesuaian harga jual eceran baru langsung dari baris tabel DSS.
4. **Anomali Selisih Kas & Frekuensi Void Kasir (`CASHIER_RISK_ANOMALY`)**:
   * Mendeteksi staf kasir yang memiliki akumulasi selisih kas minus ($\text{CashVariance} < -\text{Rp } 50.000$) atau rasio nilai *void*/retur terhadap penjualan melebihi ambang wajar dalam 14 hari terakhir.

---

## 6. Spesifikasi Antarmuka & Pintasan Keyboard Kasir (`/pos`)

Terminal `/pos` harus dirancang layaknya mesin kasir ritel sesungguhnya yang ergonomis:

1. **Dukungan Penuh Pintasan Keyboard (*Global Keybinding Listener*)**:
   * `F1`: Fokus langsung ke bilah pencarian produk / SKU.
   * `F2`: Mode Siap Pindai *Barcode* (menangkap input cepat dari *barcode scanner* atau ketik kode lalu `Enter` untuk langsung menambah kuantitas $+1$ ke keranjang).
   * `F3`: Pilih Pelanggan / Member.
   * `F4`: Tahan Struk (*Hold Bill* ke IndexedDB) / Buka Daftar Struk Tertahan.
   * `F6`: Terapkan Kode Promo / Diskon Manual.
   * `F8`: Buka Modal Pembayaran (*Checkout*: Tunai, QRIS, Kartu, atau *Split Payment*).
   * `F9`: Bayar Cepat Uang Pas (*Quick Exact Cash Checkout*).
   * `Esc`: Tutup modal aktif atau bersihkan input pencarian.
   * Tombol `+` / `-` pada baris terpilih: Tambah/kurangi kuantitas (otomatis mengaktifkan lencana **"Harga Grosir Aktif"** begitu kuantitas menyentuh ambang `min_qty`).
2. **Indikator Status Jaringan & Antrean Offline**:
   * Lencana status *real-time*: `ONLINE (Tersinkron)` vs `OFFLINE MODE (IndexedDB Aktif — X Struk di Antrean)` lengkap dengan tombol penyinkronan manual dan tombol penguji simulasi offline.
3. **Cetakan Struk Termal (`(print)/receipt/[id]`) & Laporan Tutup Shift Z-Report (`(print)/reports/shift/[id]`)**:
   * Rute `/receipt/[id]` memiliki pemilih lebar kertas (**Thermal 58mm**, **Thermal 80mm**, atau **A4 Invoice**) dengan font *monospace* tajam, rincian penghematan grosir/member, metode bayar, kembalian, dan kode verifikasi struk.

---

## 7. Standar Infrastruktur: Dual-Mode DB, Keamanan Kunci, & Git

Terapkan fondasi infrastruktur ini sejak langkah pertama:

1. **Dual-Mode Database Adapter (`src/server/db/index.ts`)**:
   * **Default (Mode Demo / Lokal):** Jika `DATABASE_URL` kosong atau diawali `pglite://` / `file:`, gunakan `@electric-sql/pglite` yang disimpan di `.data/pglite` (dengan *singleton* di `globalThis` agar aman terhadap *hot-reload* Next.js).
   * **Mode Server Produksi:** Jika `DATABASE_URL` diawali `postgres://` atau `postgresql://`, otomatis gunakan koneksi PostgreSQL Server (`postgres` / `pg`) dengan *connection pooling*.
   * Skrip `scripts/db-migrate.mjs` dan `scripts/seed.mjs` wajib mendukung kedua mode tersebut secara transparan.
2. **Keamanan Variabel Lingkungan (`src/server/env.ts` & `scripts/generate-secrets.mjs`)**:
   * Sediakan skrip `npm run secrets:generate` untuk mencetak `SESSION_SECRET` dan `RECEIPT_SIGNING_KEY` kriptografis.
   * Sediakan *fallback* lokal yang deterministik saat berjalan di mode demo/PGlite agar pengujian otomatis langsung lulus tanpa konfigurasi manual, namun wajibkan kunci produksi asli saat `NODE_ENV=production` pada PostgreSQL Server.
3. **Kunci Idempoten & Penguncian Optimistik**:
   * Semua mutasi finansial dan stok wajib membawa `requestId` (diproses idempoten di `idempotency_keys`) dan memeriksa kolom `version` pada pembaruan produk serta shift.
4. **Ekspor CSV Ramah Excel Indonesia**:
   * Seluruh endpoint `/api/export/...` wajib menyertakan UTF-8 BOM (`\uFEFF`) dan pemisah titik koma (`;`).

---

## 8. Data Seed & Akun Demo (`scripts/seed.mjs`)

Skrip `seed.mjs` harus bersifat idempoten (UUID tetap) dan menyiapkan data toko ritel yang kaya:

### Akun Demo (Kata sandi semua akun: `katalis123` | PIN Supervisor: `123456`)

| Email | Nama | Peran | PIN Supervisor | Fokus Demo |
| :--- | :--- | :--- | :--- | :--- |
| `owner@katalispos.id` | Hendra Wijaya | `SUPER_ADMIN` | `123456` | Akses penuh, pengaturan toko, audit, DSS |
| `manager@katalispos.id` | Ratna Sari | `STORE_MANAGER` | `654321` | Rekonsiliasi shift, otorisasi void/retur, opname, harga grosir |
| `kasir1@katalispos.id` | Dimas Pratama | `CASHIER` | — | Terminal POS, simulasi offline, buka/tutup shift |
| `kasir2@katalispos.id` | Putri Lestari | `CASHIER` | — | Kasir shift kedua (memiliki riwayat selisih kas untuk demo DSS) |
| `gudang@katalispos.id` | Agus Santoso | `WAREHOUSE_STAFF` | — | Penerimaan barang supplier, kartu stok, & stock opname |

### Skenario Data Awal yang Wajib Ada di Seed:
1. **16 Produk Ritel di 4 Kategori** (Sembako & Bahan Pokok, Minuman & Kemasan, Alat Tulis & Kertas, Kebutuhan Rumah Tangga) lengkap dengan kode *barcode* EAN-13, HPP (`cost_price`), harga eceran (`retail_price`), dan **8 aturan harga grosir (`product_price_tiers`)** (misal: beli $\ge 6$ pcs dan $\ge 12$ pcs otomatis turun harga).
   * Beberapa produk sengaja disetel stoknya di bawah `reorder_point`, 2 produk sebagai *dead stock* (modal besar tapi jarang laku), dan 2 produk mengalami erosi margin agar halaman `/dss` langsung menampilkan rekomendasi nyata.
2. **5 Pelanggan Member** (`REGULAR`, `SILVER`, `GOLD`, `VIP`) dan **3 Kode Promo Aktif**.
3. **3 Sesi Shift Kasir (`pos_shifts`)**:
   * 1 Shift `OPEN` milik `kasir1@katalispos.id` (agar saat penguji login sebagai Kasir 1, terminal `/pos` langsung siap bertransaksi tanpa terblokir).
   * 1 Shift `CLOSED_MATCHED` (kas fisik cocok $100\%$ dengan sistem).
   * 1 Shift `CLOSED_WITH_VARIANCE` (terdapat selisih kas kurang $-\text{Rp } 75.000$ untuk didemokan di modul audit & DSS).
4. **12 Transaksi Penjualan (`sales_orders`)**: Mencakup pembayaran Tunai, QRIS, *Split Payment*, 1 transaksi berstatus `VOIDED` (dengan jejak otorisasi PIN Supervisor), dan 1 transaksi dengan `sync_mode = 'SYNCED_FROM_OFFLINE'`.
5. **1 Konflik Sinkronisasi Offline (`offline_sync_conflicts`)** & **1 Dokumen Stock Opname (`stock_opnames`)** beserta riwayat lengkap `stock_ledgers`.

---

## 9. Instruksi Eksekusi, Pengujian Otomatis & Inisialisasi Git (Wajib)

*Coding agent* wajib mengeksekusi tahapan ini hingga tuntas tanpa menyisakan *placeholder*:

1. **Pembangunan Menyeluruh:**
   * Bangun skema Drizzle ORM, adaptor *dual-mode* PGlite/PostgreSQL, skrip migrasi & *seed*, mesin matematika `posMath.ts`, mesin IndexedDB `offlineDb.ts`, seluruh *Server Actions*, serta semua halaman App Router dan rute cetak termal/A4.
2. **Skrip Pengujian Otomatis (`scripts/e2e-verify.mjs`):**
   * Buat dan jalankan skrip pengujian otomatis menyeluruh yang memverifikasi:
     * Kesamaan hasil hitung `posMath.ts` (harga grosir bertingkat, diskon berlapis, PPN, pembulatan tunai, dan rumus HPP rata-rata tertimbang).
     * Siklus hidup Shift Kasir: Buka shift $\to$ Kas keluar $\to$ Transaksi POS $\to$ Tutup shift *Blind Drop* $\to$ Deteksi selisih (`cash_variance`).
     * Siklus Sinkronisasi Offline: Kirim *batch* transaksi luring ke `/api/pos/sync-batch` dua kali dengan `client_request_id` yang sama $\to$ pastikan transaksi kedua ditolak secara idempoten (tidak memotong stok dua kali) dan uji skenario konflik stok negatif.
     * Penegakan PIN Supervisor: Pastikan aksi *Void* struk gagal jika PIN salah atau kosong, dan berhasil serta tercatat di `audit_logs` jika PIN benar.
     * Penegakan RBAC untuk keempat peran, sanitasi parameter URL, serta validasi format ekspor CSV.
3. **Verifikasi Kompilasi & Git Init:**
   * Jalankan perintah berikut dan pastikan **0 error / 100% lulus**:
     ```bash
     npm run db:migrate
     npm run db:seed
     npx tsc --noEmit
     npm run build
     node scripts/e2e-verify.mjs
     ```
   * Siapkan `.gitignore` yang ketat (mengabaikan `node_modules/`, `.next/`, `.data/`, `.env*` kecuali `!.env.example`), buat `.env.example`, buat `README.md` serta `OVERVIEW-PM.md`, lalu inisialisasi repositori Git (`git init -b main`, `git add .`, dan buat *initial commit* yang bersih).