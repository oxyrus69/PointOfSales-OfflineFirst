"use client";

import { useState, type ReactNode } from "react";
import { Printer } from "lucide-react";

const WIDTHS = [
  { key: "58mm", label: "Thermal 58mm" },
  { key: "80mm", label: "Thermal 80mm" },
  { key: "210mm", label: "A4 Invoice" },
] as const;

type Width = (typeof WIDTHS)[number]["key"];

/**
 * Width is an inline style in mm so it applies to the screen preview and to
 * print output identically. Thermal printers cut at the sheet width.
 */
export function PrintSheet({ children, defaultWidth = "80mm" }: { children: ReactNode; defaultWidth?: Width }) {
  const [width, setWidth] = useState<Width>(defaultWidth);
  const isA4 = width === "210mm";

  return (
    <div className="min-h-dvh bg-ink-100 px-3 py-6">
      <div className="no-print mx-auto mb-4 flex max-w-[52rem] flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-paper px-3 py-2">
        <div className="flex items-center gap-1" role="group" aria-label="Lebar kertas">
          {WIDTHS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={width === option.key}
              onClick={() => setWidth(option.key)}
              className={`rounded-sm px-2.5 py-1 text-[0.75rem] font-medium transition-colors ${
                width === option.key ? "bg-ink-900 text-paper" : "text-ink-600 hover:bg-ink-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-[0.6875rem] text-ink-500">{width}</span>
          <button type="button" onClick={() => window.print()} className="btn btn-primary py-1 text-[0.75rem]">
            <Printer size={13} /> Cetak
          </button>
        </div>
      </div>

      <div
        className="print-sheet thermal mx-auto bg-white px-3 py-4 shadow-[0_1px_2px_rgba(18,17,16,0.06)]"
        style={{ width, maxWidth: "100%", fontSize: isA4 ? "12px" : "11px", lineHeight: 1.45 }}
      >
        {children}
      </div>
    </div>
  );
}
