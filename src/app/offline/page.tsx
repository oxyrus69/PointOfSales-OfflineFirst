import Link from "next/link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-50 px-4 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-ink-950 text-[0.875rem] font-bold text-paper">
        K
      </span>
      <h1 className="text-[1.5rem]">Halaman ini belum tersimpan di perangkat</h1>
      <p className="max-w-[52ch] text-[0.875rem] text-ink-600">
        Terminal kasir tetap bisa dipakai karena katalog, struk tertahan, dan antrean transaksi disimpan di perangkat.
        Halaman manajemen butuh koneksi.
      </p>
      <Link href="/pos" className="btn btn-accent">
        Buka terminal kasir
      </Link>
    </main>
  );
}
