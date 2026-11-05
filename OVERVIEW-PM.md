# OVERVIEW-PM — Katalis POS

Ringkasan untuk manajer produk: apa yang dibangun, untuk siapa, keputusan yang diambil, dan batasannya.

---

## 1. Masalah yang diselesaikan

Toko ritel kecil-menengah kehilangan uang lewat tiga jalur yang jarang terlihat di laporan penjualan biasa:

1. **Kasir berhenti saat internet putus.** Terminal berbasis cloud berhenti melayani pelanggan, atau kasir kembali ke catatan kertas.
2. **Kebocoran uang tunai di laci.** Tanpa rekonsiliasi tertutup, kasir dapat "menyamakan" angka tanpa benar-benar menghitung uang fisik.
3. **Modal mati di rak.** Barang lambat laku menahan modal, sementara barang cepat laku kehabisan stok.

Katalis POS menutup ketiganya dalam satu sistem: transaksi tetap jalan luring, laci kas direkonsiliasi tertutup, dan DSS menunjukkan di mana modal tertahan serta apa yang perlu dipesan.

---

## 2. Pengguna dan nilai yang didapat

| Peran | Yang dia dapat | Yang tidak bisa dia lakukan |
| :-- | :-- | :-- |
| **Kasir** | Terminal cepat (F1–F9), transaksi luring, buka/tutup shift sendiri | Ubah harga master, melihat saldo sistem sebelum hitung uang, void tanpa PIN |
| **Store Manager** | Setujui void/retur/opname, audit selisih kas, DSS, kelola harga & promo | Ubah pengaturan pajak/keamanan (khusus Super Admin) |
| **Super Admin** | Semua modul, pengaturan toko, PIN staf, jejak audit | — |
| **Staf Gudang** | Terima barang, hitung opname, lihat kartu stok | Akses terminal kasir atau laporan uang |

---

## 3. Alur inti

**Menjual (online)** — pindai/kode → keranjang → harga grosir otomatis → member/promo → bayar → struk termal.

**Menjual (offline)** — tombol *Simulasi Putus Jaringan* → seluruh transaksi dilayani IndexedDB → struk masuk antrean → jaringan kembali → *Sinkronkan Sekarang* → server hitung ulang, potong stok, tandai konflik bila ada.

**Menutup shift** — kasir hitung uang fisik lebih dulu (angka sistem disembunyikan) → server hitung selisih → cocok (`CLOSED_MATCHED`) atau selisih (`CLOSED_WITH_VARIANCE`) → manajer audit.

**Memutuskan** — DSS menghitung ulang tiap halaman dibuka: restock (laju jual vs lead time), dead stock (modal tertahan), erosi margin (di bawah batas produk), anomali kasir (selisih kas & rasio void).

---

## 4. Keputusan produk yang disengaja

| Keputusan | Alasan |
| :-- | :-- |
| Uang tunai dibulatkan ke Rp 100, non-tunai tidak | Pecahan Rp 1 tidak beredar; QRIS/kartu melunasi angka persis |
| Diskon berlapis berurutan: tier → member → promo(plafon) → manual | Urutan tetap membuat hasil bisa diaudit dan diprediksi |
| Stok negatif diterima, tidak menolak transaksi | Uang dan barang sudah berpindah tangan di kasir; menolak transaksi berarti menghapus penjualan nyata |
| Konflik stok jadi baris terpisah, bukan edit diam-diam | Manajer perlu melihat selisihnya untuk opname korektif |
| Void/retur hanya di halaman penuh, bukan drawer | Butuh alasan + PIN + jejak audit yang lengkap |
| PIN Supervisor dicocokkan ke semua manajer aktif | Kasir bisa memanggil manajer ke meja tanpa login ulang |
| Reset/delete data tidak disediakan di UI | Integritas ledger lebih penting daripada kenyamanan demo |

---

## 5. Cakupan data demo

16 produk / 4 kategori, 15 aturan harga grosir, 5 member (REGULAR→VIP), 3 promo aktif, 3 shift (1 OPEN, 1 cocok, 1 selisih −Rp 75.000), 12 struk (tunai/QRIS/kartu/split, 1 VOIDED ber-PIN, 1 dari offline), 1 konflik sinkronisasi terbuka, 1 opname disetujui, dan riwayat kartu stok lengkap.

Seed idempoten: menjalankan ulang tidak menggandakan data.

---

## 6. Status & batasan

**Sudah jalan dan terverifikasi:** seluruh rute, RBAC per peran, transaksi online/offline, sinkronisasi idempoten, blind close, PIN supervisor, DSS, CSV, cetak termal & A4, `tsc` bersih, build produksi bersih, 68 pemeriksaan e2e, 46 pemeriksaan rute.

**Batasan yang perlu diketahui:**

- Notifikasi real-time antar perangkat (WebSocket) belum ada; antrean dihitung saat halaman dimuat.
- Cetak langsung ke printer Bluetooth/ESC-POS belum ada; struk dicetak via dialog browser (PDF/thermal driver).
- Retur sebagian mengembalikan nilai per item, bukan proporsi diskon baris.
- Manajemen pengguna (tambah staf baru) belum punya UI; akun berasal dari seed.
- Mode demo menyimpan data di `.data/pglite` pada mesin yang menjalankan server; untuk multi-terminal produksi gunakan PostgreSQL Server.

---

## 7. Metrik yang layak dipantau

| Metrik | Sumber | Ambang sehat |
| :-- | :-- | :-- |
| Selisih kas per shift | `pos_shifts.cash_variance` | 0, toleransi ≤ Rp 5.000 |
| Struk luring menunggu | `tx_outbox` perangkat | < 5 dalam jam sibuk |
| Konflik stok terbuka | `offline_sync_conflicts.resolved = false` | 0 |
| Rasio void/retur per kasir | `sales_orders` 14 hari | < 5% nilai penjualan |
| Hari stok tersisa | DSS restock | > lead time supplier |
