import type { ToolStep } from "../../../shared/chat.ts";
import { draft_tools } from "../../../shared/tool-drafts.ts";

export type LiveDraft = { path: string; text: string; old_text: string | null; whole_file: boolean; writing: boolean };

const waiting_statuses = new Set<ToolStep["status"]>(["queued", "awaiting_approval", "running"]);

const string_arg = (step: ToolStep, key: string): string | null => {
  const value = step.args[key];
  return typeof value === "string" ? value : null;
};

export const live_draft = (step: ToolStep): LiveDraft | null => {
  const fields = draft_tools.get(step.name);
  if (!fields) {
    return null;
  }
  const whole_file = fields.before === null;
  if (step.status === "drafting") {
    const text = step.progress?.draft_text ?? "";
    const old_text = step.progress?.draft_old ?? null;
    return text || old_text ? { path: step.progress?.draft_path ?? "", text, old_text, whole_file, writing: true } : null;
  }
  if (!waiting_statuses.has(step.status) || step.view) {
    return null;
  }
  const text = string_arg(step, fields.text) ?? "";
  const old_text = fields.before === null ? null : string_arg(step, fields.before);
  return text || old_text ? { path: string_arg(step, "path") ?? "", text, old_text, whole_file, writing: false } : null;
};
