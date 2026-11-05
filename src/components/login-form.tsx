"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "@/app/actions/auth";

const DEMO_ACCOUNTS = [
  { email: "owner@katalispos.id", label: "Hendra Wijaya", role: "Super Admin", focus: "Akses penuh, DSS, audit, pengaturan" },
  { email: "manager@katalispos.id", label: "Ratna Sari", role: "Store Manager", focus: "Rekonsiliasi shift, void, opname" },
  { email: "kasir1@katalispos.id", label: "Dimas Pratama", role: "Kasir", focus: "Terminal POS + simulasi offline" },
  { email: "kasir2@katalispos.id", label: "Putri Lestari", role: "Kasir", focus: "Riwayat selisih kas untuk DSS" },
  { email: "gudang@katalispos.id", label: "Agus Santoso", role: "Staf Gudang", focus: "Penerimaan, kartu stok, opname" },
];

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("kasir1@katalispos.id");
  const [password, setPassword] = useState("katalis123");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);
    formData.set("next", next);

    const result: LoginState | null = await loginAction(null, formData);
    if (result && result.ok) {
      router.replace(result.home);
      router.refresh();
      return;
    }
    setError(result && !result.ok ? result.error : "Gagal masuk.");
    setPending(false);
  }

  return (
    <div className="grid w-full max-w-[62rem] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={handleSubmit} className="panel px-5 py-6 sm:px-7">
        <div className="mb-6">
          <p className="label-xs">Terminal masuk</p>
          <h1 className="mt-1.5 text-[1.5rem]">Mulai shift dengan akun Anda</h1>
          <p className="mt-1.5 max-w-[46ch] text-[0.875rem] text-ink-600">
            Setiap peran melihat modul yang berbeda. Kasir masuk langsung ke terminal, gudang ke inventaris,
            manajer ke dasbor.
          </p>
        </div>

        <label className="block">
          <span className="label-xs">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field mt-1.5"
            placeholder="nama@katalispos.id"
          />
        </label>

        <label className="mt-4 block">
          <span className="label-xs">Kata sandi</span>
          <span className="relative mt-1.5 block">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="field pr-10"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-xs text-ink-500 hover:bg-ink-100"
              aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
        </label>

        {error ? (
          <p role="alert" className="mt-4 rounded-sm border border-alert-100 bg-alert-100 px-3 py-2 text-[0.8125rem] text-alert-700">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className="btn btn-accent mt-5 w-full">
          {pending ? <Loader2 size={15} className="animate-spin" /> : null}
          {pending ? "Memverifikasi…" : "Masuk ke terminal"}
        </button>

        <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-500">
          Data demo tersedia untuk semua akun dengan kata sandi <span className="num text-ink-700">katalis123</span> dan
          PIN Supervisor <span className="num text-ink-700">123456</span> (owner) / <span className="num text-ink-700">654321</span> (manajer).
        </p>
      </form>

      <aside className="panel px-4 py-5">
        <p className="label-xs">Akun demo</p>
        <ul className="mt-3 space-y-1">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword("katalis123");
                  setError(null);
                }}
                className={`w-full rounded-sm px-2.5 py-2 text-left transition-colors ${
                  email === account.email ? "bg-ink-900 text-paper" : "hover:bg-ink-100"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.8125rem] font-medium">{account.label}</span>
                  <span className={`text-[0.6875rem] ${email === account.email ? "text-ink-300" : "text-ink-500"}`}>
                    {account.role}
                  </span>
                </span>
                <span
                  className={`mt-0.5 block text-[0.6875rem] leading-snug ${
                    email === account.email ? "text-ink-400" : "text-ink-500"
                  }`}
                >
                  {account.focus}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-ink-100 pt-3 text-[0.6875rem] leading-relaxed text-ink-500">
          Pilih akun untuk mengisi formulir. Tidak ada data yang dikirim sampai Anda menekan tombol masuk.
        </p>
      </aside>
    </div>
  );
}
