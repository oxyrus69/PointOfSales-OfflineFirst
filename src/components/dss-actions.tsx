"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { acknowledgeDecisionAction, setDecisionStatusAction } from "@/app/actions/dss";
import type { DecisionCategory } from "@/server/db/schema";

export function DecisionButton({
  ruleCode,
  subjectId,
  subjectLabel,
  payload,
}: {
  ruleCode: DecisionCategory;
  subjectId: string;
  subjectLabel: string;
  payload: Record<string, unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="tag tag-grove">
        <Check size={11} /> tercatat
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await acknowledgeDecisionAction({ ruleCode, subjectId, subjectLabel, payload });
        setBusy(false);
        if (result.ok) setDone(true);
      }}
      className="btn btn-ghost py-1 text-[0.75rem]"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
      Tandai ditangani
    </button>
  );
}

export function DecisionStatusButtons({ decisionId }: { decisionId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("NEW");

  async function apply(next: "ACKNOWLEDGED" | "ACTIONED" | "DISMISSED") {
    setBusy(next);
    const result = await setDecisionStatusAction({ decisionId, status: next });
    setBusy(null);
    if (result.ok) setStatus(next);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {(
        [
          { key: "ACKNOWLEDGED", label: "Diketahui" },
          { key: "ACTIONED", label: "Ditindak" },
          { key: "DISMISSED", label: "Diabaikan" },
        ] as const
      ).map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={busy !== null || status === option.key}
          onClick={() => void apply(option.key)}
          className={`btn py-1 text-[0.6875rem] ${status === option.key ? "btn-primary" : "btn-ghost"}`}
        >
          {busy === option.key ? <Loader2 size={11} className="animate-spin" /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
