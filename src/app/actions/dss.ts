"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/rbac";
import { fail, type ActionResult } from "@/server/services/errors";
import { logDecision, updateDecisionStatus } from "@/server/services/dssEngine";
import type { DecisionCategory } from "@/server/db/schema";

export async function acknowledgeDecisionAction(input: {
  ruleCode: DecisionCategory;
  subjectId: string;
  subjectLabel: string;
  payload: Record<string, unknown>;
}): Promise<ActionResult<{ decisionId: string }>> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    const decisionId = await logDecision({
      ruleCode: input.ruleCode,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      payload: input.payload,
    });
    revalidatePath("/dss");
    revalidatePath("/dss/riwayat");
    void user;
    return { ok: true, data: { decisionId } };
  } catch (error) {
    return fail(error);
  }
}

export async function setDecisionStatusAction(input: {
  decisionId: string;
  status: "ACKNOWLEDGED" | "ACTIONED" | "DISMISSED";
}): Promise<ActionResult> {
  try {
    const user = await requireRole("SUPER_ADMIN", "STORE_MANAGER");
    await updateDecisionStatus({ decisionId: input.decisionId, status: input.status, actorId: user.id });
    revalidatePath("/dss");
    revalidatePath("/dss/riwayat");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
