import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatIdr, formatNumber, toNumber } from "@/lib/format";

/**
 * Zone D1 — KPI card with four information layers:
 * label + hint, primary value (tabular mono), delta/sparkline, footer context.
 * Never a bare number in a box.
 */
export function KpiStatCard({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  series,
  footer,
  tone = "neutral",
  currency = true,
}: {
  label: string;
  value: number | string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  series?: number[];
  footer?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  currency?: boolean;
}) {
  const display = typeof value === "number" ? (currency ? formatIdr(value) : formatNumber(value)) : value;

  const valueTone =
    tone === "danger" ? "text-alert-700" : tone === "warning" ? "text-caution-700" : tone === "success" ? "text-grove-700" : "text-ink-900";

  const deltaTone =
    delta === null || delta === undefined || delta === 0
      ? "tag-neutral"
      : delta > 0
        ? "tag-grove"
        : "tag-alert";

  return (
    <div className="panel flex min-w-0 flex-col justify-between px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="label-xs leading-tight">{label}</p>
        {series && series.length > 1 ? <Sparkline values={series} /> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className={`num min-w-0 break-words text-[1.375rem] font-semibold leading-none tracking-[-0.02em] ${valueTone}`}>
          {display}
        </p>
        {delta !== null && delta !== undefined ? (
          <span className={`tag ${deltaTone}`}>
            {delta > 0 ? <ArrowUpRight size={11} /> : delta < 0 ? <ArrowDownRight size={11} /> : <Minus size={11} />}
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 border-t border-ink-100 pt-2">
        {footer ? <div className="text-[0.75rem] leading-snug text-ink-500">{footer}</div> : null}
        {!footer && hint ? <p className="text-[0.75rem] leading-snug text-ink-500">{hint}</p> : null}
        {!footer && !hint && deltaLabel ? <p className="text-[0.75rem] leading-snug text-ink-500">{deltaLabel}</p> : null}
      </div>
    </div>
  );
}

/** Inline SVG sparkline, 64×22, no dependencies and no re-render cost. */
export function Sparkline({ values, width = 64, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const points = values.map((value) => toNumber(value));
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-400" />
    </svg>
  );
}

/** Zone D3 — segmented health bar (share of states in one thin row). */
export function SegmentedHealthBar({
  segments,
}: {
  segments: { label: string; value: number; tone: "success" | "warning" | "danger" | "neutral" }[];
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  const color = {
    success: "bg-grove-600",
    warning: "bg-caution-700",
    danger: "bg-alert-600",
    neutral: "bg-ink-300",
  } as const;

  return (
    <div className="space-y-2">
      <div className="flex h-1.5 w-full overflow-hidden rounded-pill bg-ink-100">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={color[segment.tone]}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.75rem]">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-ink-600">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${color[segment.tone]}`} />
              <span className="truncate">{segment.label}</span>
            </span>
            <span className="num shrink-0 font-medium text-ink-900">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Zone D3 — vertical activity timeline. */
export function ActivityStream({
  items,
}: {
  items: { title: string; meta: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }[];
}) {
  const dot = {
    success: "bg-grove-600",
    warning: "bg-caution-700",
    danger: "bg-alert-600",
    info: "bg-signal-700",
    neutral: "bg-ink-300",
  } as const;

  if (items.length === 0) {
    return <p className="text-[0.75rem] text-ink-500">Belum ada aktivitas.</p>;
  }

  return (
    <ol className="relative space-y-2.5 border-l border-ink-100 pl-3.5">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="relative">
          <span className={`absolute -left-[1.19rem] top-1 h-1.5 w-1.5 rounded-pill ring-2 ring-paper ${dot[item.tone]}`} />
          <p className="text-[0.8125rem] leading-snug text-ink-800">{item.title}</p>
          <p className="num text-[0.6875rem] leading-snug text-ink-500">{item.meta}</p>
        </li>
      ))}
    </ol>
  );
}
