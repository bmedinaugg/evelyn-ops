"use server";

import { revalidatePath } from "next/cache";
import {
  createCaseProposal,
  addCaseProposalComment,
  setCaseProposalStatus,
  runCaseTrial,
} from "@/lib/queries";
import type {
  CaseProposalKind,
  CaseProposalStance,
  CaseProposalStatus,
} from "@/lib/types";

const KINDS: CaseProposalKind[] = ["wrong_fact", "wrong_source", "wrong_behaviour", "missing"];
const STANCES: CaseProposalStance[] = ["agree", "object", "comment"];
const DECISIONS: Exclude<CaseProposalStatus, "open">[] = [
  "accepted", "implemented", "rejected", "withdrawn",
];

export type ProposeState = { error?: string; ok?: boolean; id?: string };

function revalidate(caseKey: string | null, sessionId: string | null) {
  revalidatePath("/cases");
  if (caseKey) revalidatePath(`/cases/${caseKey}`);
  if (sessionId) revalidatePath(`/conversations/${sessionId}`);
}

export async function propose(
  _prev: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const kindRaw = String(formData.get("kind") || "");
  const kind = (KINDS as string[]).includes(kindRaw) ? (kindRaw as CaseProposalKind) : null;
  if (!kind) return { error: "Pick what kind of change this is." };
  const caseKey = String(formData.get("case_key") || "").trim() || null;
  const title = String(formData.get("title") || "").trim() || null;
  const shouldBe = String(formData.get("should_be") || "");
  const rationale = String(formData.get("rationale") || "").trim() || null;
  const sessionId = String(formData.get("session_id") || "").trim() || null;
  try {
    const id = await createCaseProposal({
      caseKey, title, kind, shouldBe, rationale, exampleSessionId: sessionId,
    });
    revalidate(caseKey, sessionId);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the proposal." };
  }
}

export async function reply(
  _prev: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const proposalId = String(formData.get("proposal_id") || "");
  const caseKey = String(formData.get("case_key") || "").trim() || null;
  const stanceRaw = String(formData.get("stance") || "comment");
  const stance = (STANCES as string[]).includes(stanceRaw) ? (stanceRaw as CaseProposalStance) : "comment";
  const body = String(formData.get("body") || "").trim() || null;
  if (!proposalId) return { error: "Missing proposal." };
  try {
    await addCaseProposalComment({ proposalId, stance, body });
    revalidate(caseKey, null);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not add the reply." };
  }
}

// Plain form action: the decision buttons need no client state.
export async function decide(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") || "");
  const caseKey = String(formData.get("case_key") || "").trim() || null;
  const statusRaw = String(formData.get("status") || "");
  if (!proposalId || !(DECISIONS as string[]).includes(statusRaw)) return;
  const note = String(formData.get("note") || "").trim() || null;
  await setCaseProposalStatus({
    proposalId, status: statusRaw as Exclude<CaseProposalStatus, "open">, note,
  });
  revalidate(caseKey, null);
}

export type TrialState = { error?: string; ok?: boolean };

// Run one message through the real sub-workflow for this case. The reply is
// stored and the page re-renders with it; nothing else changes.
export async function tryIt(
  _prev: TrialState,
  formData: FormData,
): Promise<TrialState> {
  const caseKey = String(formData.get("case_key") || "").trim();
  const targetWorkflowId = String(formData.get("target_workflow_id") || "").trim();
  const message = String(formData.get("message") || "");
  const proposalId = String(formData.get("proposal_id") || "").trim() || null;
  if (!caseKey || !targetWorkflowId) return { error: "Missing case." };
  try {
    await runCaseTrial({ caseKey, targetWorkflowId, message, proposalId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not run it." };
  }
  revalidatePath(`/cases/${caseKey}`);
  return { ok: true };
}
