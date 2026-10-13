import type { ToolStep } from "../../../shared/chat.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import type { Translate } from "../../i18n/translate.ts";
import { live_draft } from "./live-draft.ts";
import { step_outcome, type OutcomeNote } from "./review-notes.ts";
import { is_reviewing } from "./review-phase.ts";
import { compact_command, is_active_status } from "./tool-meta.ts";

const output_views = new Set<ToolViewKind>(["command", "mcp", "text"]);

const inline_tools = new Set(["datetime", "view_image"]);

const notice_views = new Set<ToolViewKind>(["command", "background", "mcp"]);

export const view_content = (t: Translate, step: ToolStep, view: ToolView): boolean => {
  switch (view.kind) {
    case "files":
      return view.files.length > 0;
    case "grep":
      return view.matches.length > 0;
    case "outline":
      return view.symbols.length > 0;
    case "edit":
      return view.diff.length > 0;
    case "command": {
      const outcome = step_outcome(t, step);
      return view.output !== "" || view.cwd !== "." || !compact_command(view.command) || outcome.notice !== null || outcome.footer.length > 0;
    }
    case "agent":
      return view.report !== "";
    case "todos":
      return view.todos.length > 0;
    case "web_search":
      return view.sources.length > 0 || view.answer !== "";
    case "image":
      return view.images.length > 0 || view.prompt !== "";
    case "models":
      return view.models.length > 0;
    case "text":
      return view.text !== "" && !inline_tools.has(step.name);
    case "plan":
    case "mcp":
    case "memory":
      return view.text !== "";
    case "background":
    case "questions":
    case "peer_message":
      return true;
    case "read":
    case "browser":
    case "skill":
      return false;
  }
};

export const denial_note = (t: Translate, step: ToolStep): OutcomeNote | null =>
  step.status === "denied" && !(step.view && notice_views.has(step.view.kind)) ? step_outcome(t, step).notice : null;

export const shown_error = (step: ToolStep): string | null => (step.view && output_views.has(step.view.kind) ? null : step.error);

export const has_body = (t: Translate, step: ToolStep): boolean =>
  is_reviewing(step) ||
  Boolean(shown_error(step)) ||
  Boolean(step.progress?.output_tail) ||
  live_draft(step) !== null ||
  (denial_note(t, step)?.lines.length ?? 0) > 0 ||
  (step.view ? view_content(t, step, step.view) : step.status !== "denied" && !is_active_status(step.status) && step.result_text !== "");
