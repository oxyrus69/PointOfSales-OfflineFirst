"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Zone E — right slide-over inspector (480px) with tabs. Keeps the table and its
 * filters visible while the operator inspects or acts on one row.
 */
export function InspectorDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  tabs,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  tabs: { key: string; label: string; content: ReactNode }[];
  footer?: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? "");

  useEffect(() => {
    if (open) setActiveTab(tabs[0]?.key ?? "");
  }, [open, tabs]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Tutup inspeksi" onClick={onClose} className="absolute inset-0 bg-ink-950/35" />
      <aside className="relative flex h-full w-full max-w-[30rem] flex-col border-l border-ink-200 bg-paper shadow-[-24px_0_60px_-40px_rgba(18,17,16,0.6)]">
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
              {badge}
            </div>
            {subtitle ? <p className="num mt-0.5 truncate text-[0.75rem] text-ink-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="btn-quiet" aria-label="Tutup">
            <X size={15} />
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-ink-100 px-3 py-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={current?.key === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-xs px-2 py-1 text-[0.75rem] font-medium transition-colors ${
                current?.key === tab.key ? "bg-ink-900 text-paper" : "text-ink-600 hover:bg-ink-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">{current?.content}</div>

        {footer ? <footer className="border-t border-ink-200 px-4 py-2.5">{footer}</footer> : null}
      </aside>
    </div>
  );
}
