import Link from "next/link";
import type { ReactNode } from "react";
import { formatIdr } from "@/lib/format";

/* Pure presentational primitives. No client hooks, so every page can be a
   Server Component and only the interactive leaves ship JavaScript. */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  tabs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="space-y-2.5 border-b border-ink-200 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow ? <span className="label-xs">{eyebrow}</span> : null}
            {meta}
          </div>
          <h1 className="mt-0.5 text-[1.0625rem] font-semibold tracking-[-0.015em] sm:text-[1.125rem]">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-[76ch] text-[0.8125rem] leading-snug text-ink-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
      {tabs}
    </header>
  );
}

/** Zone C view controller: segmented buttons + period selector, right aligned. */
export function ViewController({
  segments,
  active,
  onChange,
  period,
}: {
  segments: { key: string; label: string; count?: number }[];
  active: string;
  onChange?: (key: string) => void;
  period?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-sm bg-ink-100 p-0.5" role="group" aria-label="Mode tampilan">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            aria-pressed={active === segment.key}
            onClick={() => onChange?.(segment.key)}
            className={`rounded-xs px-2 py-1 text-[0.75rem] font-medium transition-colors ${
              active === segment.key ? "bg-paper text-ink-900 shadow-[0_1px_2px_rgba(18,17,16,0.08)]" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {segment.label}
            {segment.count !== undefined ? <span className="num ml-1 text-ink-400">{segment.count}</span> : null}
          </button>
        ))}
      </div>
      {period ? <div className="flex items-center gap-1.5">{period}</div> : null}
    </div>
  );
}

export function Panel({
  children,
  className = "",
  title,
  description,
  actions,
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
            {description ? <p className="mt-0.5 text-[0.8125rem] text-ink-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "px-4 py-4"}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "accent" | "grove" | "alert" | "caution" | "signal";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "signal",
  CLOSED_MATCHED: "grove",
  CLOSED_WITH_VARIANCE: "caution",
  AUDITED: "neutral",
  COMPLETED: "grove",
  VOIDED: "alert",
  PARTIALLY_REFUNDED: "caution",
  REFUNDED: "caution",
  DIRECT_ONLINE: "neutral",
  SYNCED_FROM_OFFLINE: "signal",
  SYNC_CONFLICT_RESOLVED: "caution",
  DRAFT: "neutral",
  SUBMITTED: "signal",
  APPROVED: "grove",
  REJECTED: "alert",
  NEW: "signal",
  ACKNOWLEDGED: "caution",
  ACTIONED: "grove",
  DISMISSED: "neutral",
  CASH: "neutral",
  QRIS: "signal",
  DEBIT_CARD: "signal",
  CREDIT_CARD: "signal",
  SPLIT_PAYMENT: "caution",
};

export function StatusBadge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "neutral";
  return <Badge tone={tone}>{value.replace(/_/g, " ")}</Badge>;
}

export function Money({ value, className = "", muted = false }: { value: number | string | null | undefined; className?: string; muted?: boolean }) {
  return <span className={`num ${muted ? "text-ink-500" : ""} ${className}`}>{formatIdr(value)}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const accent =
    tone === "alert" ? "text-alert-700" : tone === "caution" ? "text-caution-700" : tone === "grove" ? "text-grove-700" : "text-ink-900";
  return (
    <div className="panel px-4 py-3.5">
      <p className="label-xs">{label}</p>
      <p className={`num mt-1.5 text-[1.5rem] font-semibold leading-none ${accent}`}>{value}</p>
      {hint ? <p className="mt-2 text-[0.75rem] leading-snug text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-ink-200 px-5 py-8">
      <p className="text-[0.9375rem] font-medium text-ink-800">{title}</p>
      {description ? <p className="max-w-[60ch] text-[0.8125rem] text-ink-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 border-b border-ink-100 pb-1.5 last:border-0">
          <dt className="text-[0.8125rem] text-ink-500">{item.label}</dt>
          <dd className={`num text-right text-[0.875rem] ${item.strong ? "font-semibold text-ink-900" : "text-ink-800"}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTabs({
  items,
  active,
}: {
  items: { href: string; label: string }[];
  active: string;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-ink-100 pb-2">
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${
              isActive ? "bg-ink-900 text-paper" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Callout({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  const map: Record<Tone, string> = {
    neutral: "border-ink-200 bg-ink-50 text-ink-800",
    accent: "border-flame-100 bg-flame-50 text-flame-700",
    grove: "border-grove-100 bg-grove-100 text-grove-700",
    alert: "border-alert-100 bg-alert-100 text-alert-700",
    caution: "border-caution-100 bg-caution-100 text-caution-700",
    signal: "border-signal-100 bg-signal-100 text-signal-700",
  };
  return (
    <div className={`rounded-md border px-3.5 py-3 text-[0.8125rem] leading-relaxed ${map[tone]}`}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
