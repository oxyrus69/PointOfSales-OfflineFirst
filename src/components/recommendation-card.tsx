import { Badge } from "@/components/ui";
import { DecisionButton } from "@/components/dss-actions";
import type { DssRecommendation } from "@/server/services/dssEngine";

const SEVERITY_TONE = { critical: "alert", warning: "caution", info: "signal" } as const;

export function RecommendationCard({ item }: { item: DssRecommendation }) {
  return (
    <article className="rounded-md border border-ink-100 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[item.severity]}>{item.severity}</Badge>
            <span className="num text-[0.75rem] text-ink-500">{item.ruleCode.replace(/_/g, " ")}</span>
          </div>
          <p className="mt-1.5 text-[0.9375rem] font-medium">{item.headline}</p>
          <p className="num text-[0.75rem] text-ink-600">{item.subjectLabel}</p>
        </div>
        <DecisionButton
          ruleCode={item.ruleCode}
          subjectId={item.subjectId}
          subjectLabel={item.subjectLabel}
          payload={item.payload}
        />
      </div>

      <p className="mt-2 max-w-[74ch] text-[0.8125rem] leading-relaxed text-ink-700">{item.detail}</p>

      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ink-100 pt-2.5 text-[0.75rem] sm:grid-cols-4">
        {item.metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-ink-500">{metric.label}</dt>
            <dd className="num font-medium text-ink-900">{metric.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[0.8125rem] text-ink-800">
        <span className="font-medium">Tindakan: </span>
        {item.suggestedAction}
      </p>
    </article>
  );
}

export { SEVERITY_TONE };
