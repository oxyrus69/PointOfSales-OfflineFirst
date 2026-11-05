# Katalis POS

Terminal kasir ritel **offline-first** dengan rekonsiliasi laci kasir tertutup (_blind drop_), harga grosir otomatis, HPP rata-rata tertimbang, dan sistem pendukung keputusan (DSS) ritel.

Transaksi tetap jalan penuh saat internet putus: katalog, keranjang, struk tertahan, dan pembayaran dilayani dari IndexedDB perangkat, lalu disinkronkan ke server secara idempoten ketika jaringan kembali.

---

## 1. Menjalankan

```bash
npm install
npm run db:migrate     # buat skema (PGlite lokal atau PostgreSQL)
npm run db:seed        # data demo idempoten
npm run dev            # http://localhost:3000
```

Semua perintah di atas bekerja tanpa konfigurasi tambahan karena default memakai **PGlite** (PostgreSQL di dalam proses, tersimpan di `.data/pglite`).

### Mode PostgreSQL Server

```bash
DATABASE_URL=postgres://user:pass@host:5432/katalis npm run db:migrate
DATABASE_URL=postgres://user:pass@host:5432/katalis npm run db:seed
DATABASE_URL=postgres://user:pass@host:5432/katalis npm run dev
```

Tidak ada perubahan kode: `src/server/db/index.ts` memilih driver dari bentuk `DATABASE_URL`.

### Kunci produksi

```bash
npm run secrets:generate   # cetak SESSION_SECRET & RECEIPT_SIGNING_KEY
```

Saat `NODE_ENV=production` dengan PostgreSQL Server, kunci demo **ditolak** dan aplikasi gagal start bila kuncinya kosong.

---

## 2. Akun demo

Kata sandi semua akun: `katalis123`

| Email | Nama | Peran | PIN Supervisor |
| :-- | :-- | :-- | :-- |
| `owner@katalispos.id` | Hendra Wijaya | SUPER_ADMIN | `123456` |
| `manager@katalispos.id` | Ratna Sari | STORE_MANAGER | `654321` |
| `kasir1@katalispos.id` | Dimas Pratama | CASHIER | — |
| `kasir2@katalispos.id` | Putri Lestari | CASHIER | — |
| `gudang@katalispos.id` | Agus Santoso | WAREHOUSE_STAFF | — |

---

## 3. Peta modul

| Rute | Isi |
| :-- | :-- |
| `/admin` | Dasbor: KPI strip, tren 14 hari + tabel matriks, antrean prioritas, rail DSS & aktivitas |
| `/pos` | Terminal kasir: pindai barcode, keranjang, harga grosir, split payment, mode offline |
| `/pos/sync` | Antrean luring, konflik stok, riwayat sinkronisasi perangkat |
| `/shifts`, `/shifts/[id]` | Buka shift, kas masuk/keluar, tutup shift _blind drop_, Z-Report |
| `/transactions`, `/transactions/[id]` | Riwayat, void & retur dengan PIN supervisor |
| `/products`, `/products/[id]` | Katalog, harga bertingkat, kartu stok |
| `/inventory`, `/inventory/opname`, `/inventory/receiving` | Stok, opname berjenjang persetujuan, penerimaan + HPP tertimbang |
| `/customers`, `/promos` | Member bertingkat dan kode promo berplafon |
| `/dss`, `/dss/restock`, `/dss/anomalies`, `/dss/riwayat` | Rekomendasi restock, dead stock, erosi margin, anomali kasir |
| `/admin/audit`, `/admin/settings` | Jejak audit, pengaturan toko, PIN staf |
| `/receipt/[id]`, `/reports/shift/[id]` | Cetak termal 58/80mm & A4 |

---

## 4. Keputusan teknis yang perlu diketahui

**Matematika tunggal.** `src/lib/posMath.ts` dipakai terminal (browser) dan validator (server). Harga grosir, diskon berlapis, PPN proporsional, dan pembulatan tunai dihitung dengan fungsi yang sama persis, sehingga struk tidak bisa berbeda antara perangkat dan server.

**Idempotensi mutlak.** Setiap transaksi membawa `client_request_id`. Batch yang sama dikirim dua kali mengembalikan `ALREADY_SYNCED` tanpa memotong stok dua kali. Diuji di `scripts/e2e-verify.mjs`.

**Stok negatif bukan alasan menolak uang.** Bila transaksi luring membuat stok server negatif, penjualan tetap sah (barang dan uang sudah berpindah tangan) dan baris `offline_sync_conflicts` dibuat untuk direkonsiliasi manajer.

**Blind drop.** Angka `expected_cash_system` tidak pernah dikirim ke antarmuka sebelum kasir mengirim hitungan fisiknya. Selisih di atas toleransi memerlukan PIN Supervisor.

**Ledger tunggal.** Semua perubahan stok melewati `applyStockMovement()` yang menulis `stock_ledgers` dengan `qty_before`/`qty_after` dalam satu operasi, sehingga kartu stok tidak bisa menyimpang dari `stock_on_hand`.

**Struk bertanda tangan.** Setiap struk menyimpan HMAC-SHA256 atas `id|nomor|waktu|total`. Halaman detail memverifikasi ulang; mengubah angka langsung di database membuat verifikasi gagal.

---

## 5. Verifikasi

```bash
npm run typecheck              # tsc --noEmit
npm run build                  # build produksi
npm run e2e                    # 68 pemeriksaan mesin + siklus DB
node --import ./scripts/lib/register-alias.mjs scripts/verify-pages.mjs   # crawl semua rute + RBAC + CSV
```

`npm run e2e` menjalankan database uji terpisah (`.data/e2e-pglite`) yang dibersihkan setelah selesai, jadi dataset demo tidak tersentuh.

Cakupan e2e:

1. **posMath** — resolusi tier, diskon member→promo(plafon)→manual, DPP hanya item kena pajak, PPN, pembulatan tunai, HPP rata-rata tertimbang (termasuk stok lama negatif), kas seharusnya, kembalian.
2. **Siklus shift** — buka → kas keluar kecil (tanpa PIN) → kas keluar besar (ditolak tanpa PIN) → tutup blind → selisih −12.500 → shift tidak bisa ditutup dua kali.
3. **Sinkronisasi offline** — batch pertama `SYNCED`, stok −5 melewati stok 3 → konflik tercatat, batch kedua `ALREADY_SYNCED`, stok tetap, ledger tepat satu baris, penyimpangan total dicatat audit.
4. **PIN Supervisor** — PIN kosong & salah ditolak (status struk tidak berubah), PIN benar mem-void, stok kembali, jejak audit mencatat keduanya.
5. **RBAC, sanitasi, CSV** — pemetaan peran per rute, sanitasi UUID/teks/enum, CSV dengan BOM + titik koma.

---

## 6. Cetak

- **Struk termal:** `/receipt/[orderId]` atau `/receipt/[nomor-struk]`, pemilih 58mm / 80mm / A4.
- **Z-Report:** `/reports/shift/[shiftId]`, ringkasan penjualan, metode bayar, arus laci, dan selisih.

Keduanya memakai `@media print` dengan latar putih bersih dan tanpa navigasi.

---

## 7. Struktur singkat

```
src/
  app/
    (app)/            rute terautentikasi di dalam 5-zone shell
    (print)/          struk & Z-Report
    api/              catalog-snapshot, sync-batch, export CSV, auth
    actions/          Server Actions (auth, pos, shifts, admin, dss)
  components/         shell, data grid, inspector, KPI, terminal, form
  lib/                posMath, offlineDb (IndexedDB), format, params, hmac
  server/
    db/               schema Drizzle + dual-mode adapter
    services/         posSyncEngine, shiftEngine, inventoryEngine, dssEngine, dss
scripts/              db-migrate, seed, e2e-verify, verify-pages
```
