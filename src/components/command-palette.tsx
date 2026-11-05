"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search, X } from "lucide-react";

export type PaletteItem = {
  label: string;
  hint: string;
  href: string;
  group: "Halaman" | "Aksi" | "Modul";
  keywords?: string;
};

/**
 * Global command palette (Ctrl/Cmd+K). Arrow keys move, Enter opens, Esc closes.
 * Kept dependency-free: a dialog needs no library to behave correctly.
 */
export function CommandPalette({ items, compact = false }: { items: PaletteItem[]; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteKey) {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setActive(0);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pool = items.filter((item) => !item.href || item.href !== pathname);
    if (!term) return pool.slice(0, 9);
    return pool
      .filter(
        (item) =>
          item.label.toLowerCase().includes(term) ||
          item.hint.toLowerCase().includes(term) ||
          (item.keywords ?? "").toLowerCase().includes(term),
      )
      .slice(0, 9);
  }, [items, pathname, query]);

  function commit(index: number) {
    const target = filtered[index];
    if (!target) return;
    setOpen(false);
    setQuery("");
    router.push(target.href);
  }

  if (!open) {
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-600 hover:bg-ink-100"
          aria-label="Buka pencarian global"
        >
          <Search size={15} />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full min-w-0 max-w-[22rem] items-center gap-2 rounded-sm border border-ink-200 bg-paper px-2.5 text-left text-[0.8125rem] text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700"
        aria-label="Buka pencarian global"
      >
        <Search size={13} className="shrink-0" />
        <span className="truncate">Cari halaman, struk, atau aksi…</span>
        <span className="kbd ml-auto hidden shrink-0 text-ink-400 sm:inline-flex">Ctrl K</span>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/45 px-3 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Pencarian global"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-[34rem] overflow-hidden rounded-md border border-ink-200 bg-paper shadow-[0_24px_60px_-24px_rgba(18,17,16,0.5)]">
        <div className="flex items-center gap-2 border-b border-ink-100 px-3">
          <Search size={15} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit(active);
              }
            }}
            placeholder="Ketik nama halaman, nomor struk, atau aksi…"
            className="min-w-0 flex-1 basis-0 bg-transparent py-3 text-[0.9375rem] outline-none placeholder:text-ink-400"
            aria-label="Kata kunci pencarian"
          />
          <button type="button" onClick={() => setOpen(false)} className="btn-quiet" aria-label="Tutup pencarian">
            <X size={14} />
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="px-3.5 py-6 text-[0.8125rem] text-ink-500">Tidak ada hasil untuk “{query}”.</p>
        ) : (
          <ul className="max-h-[22rem] overflow-y-auto py-1">
            {filtered.map((item, index) => (
              <li key={`${item.group}-${item.label}-${item.href}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
                    active === index ? "bg-ink-100" : ""
                  }`}
                >
                  <span className="tag tag-neutral shrink-0">{item.group}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium">{item.label}</span>
                    <span className="block truncate text-[0.75rem] text-ink-500">{item.hint}</span>
                  </span>
                  {active === index ? <CornerDownLeft size={13} className="shrink-0 text-ink-400" /> : <ArrowRight size={13} className="shrink-0 text-ink-300" />}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-ink-100 px-3.5 py-2 text-[0.6875rem] text-ink-500">
          <span>
            <span className="kbd mr-1">↑</span>
            <span className="kbd mr-1">↓</span> pilih
          </span>
          <span>
            <span className="kbd mr-1">Enter</span> buka
          </span>
          <span>
            <span className="kbd mr-1">Esc</span> tutup
          </span>
        </div>
      </div>
    </div>
  );
}
