import type { ToolStep } from "../../../shared/chat.ts";
import { call_shell, command_tools, is_shell_run, shell_labels } from "../../../shared/shell.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import type { Translate } from "../../i18n/translate.ts";
import { shows_shot } from "./computer-shots.ts";
import { failure_text } from "./failure-text.ts";
import { step_hooks } from "./hook-runs.ts";
import { live_draft } from "./live-draft.ts";
import { step_outcome, type OutcomeNote } from "./review-notes.ts";
import { is_command_step, is_reviewing } from "./review-phase.ts";
import { compact_command, is_active_status } from "./tool-meta.ts";
import { viewed_image } from "./work-steps.ts";

const output_views = new Set<ToolViewKind>(["command", "text"]);

const inline_tools = new Set(["datetime", "context_status", "list_agents"]);

const notice_views = new Set<ToolViewKind>(["command", "background"]);

const collapsed_views = new Set<ToolViewKind>(["todos", "read", "browser"]);

const message_tools = new Set(["message_agent", "message_peer", "message_main_agent"]);

export const is_agent_message = (step: ToolStep): boolean => message_tools.has(step.name);

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
      return (
        view.output !== "" ||
        view.cwd !== "." ||
        !compact_command(view.command) ||
        view.timed_out ||
        (view.exit_code ?? 0) !== 0 ||
        outcome.notice !== null ||
        outcome.footer.length > 0
      );
    }
    case "agent":
      return view.report !== "";
    case "web_search":
      return view.sources.length > 0 || view.answer !== "";
    case "image":
      return view.images.length > 0;
    case "shown_images":
      return view.images.length > 0;
    case "models":
      return view.models.length > 0;
    case "text":
      if (step.name === "view_image") {
        return viewed_image(step) !== null;
      }
      return view.text !== "" && !inline_tools.has(step.name);
    case "mcp":
      return view.text !== "" && step.status !== "denied";
    case "plan":
    case "memory":
      return view.text !== "";
    case "hooks":
      return view.hooks.length > 0;
    case "scheduled_tasks":
      return view.tasks.length > 0;
    case "computer":
      return shows_shot(step, view);
    case "todos":
      return view.todos.length > 0;
    case "background":
    case "peer_message":
      return true;
    case "read":
      return Boolean(view.content);
    case "browser":
      return view.output !== undefined;
    case "tool_load":
    case "skill":
    case "questions":
    case "visual":
    case "generated_images":
    case "workflow":
      return false;
  }
};

export const denial_note = (t: Translate, step: ToolStep): OutcomeNote | null =>
  step.status === "denied" && !(step.view && notice_views.has(step.view.kind)) ? step_outcome(t, step).notice : null;

const shows_own_error = (view: ToolView | null): boolean => {
  if (view?.kind === "mcp") {
    return view.text !== "";
  }
  if (view?.kind === "browser") {
    return view.output !== undefined;
  }
  return Boolean(view && (output_views.has(view.kind) || (view.kind === "web_search" && view.failed?.length)));
};

const error_text = (t: Translate, step: ToolStep): string | null => (step.failure ? failure_text(t, step.failure) : step.error);

export type ErrorCard = { kind: "code"; label: string; code: string; prompt: boolean; text: string } | { kind: "file"; path: string; text: string };

const file_card_tools = new Set(["read_file", "write_file", "replace_in_file"]);

const text_arg = (step: ToolStep, key: string): string => (typeof step.args[key] === "string" ? step.args[key] : "");

export const error_card = (t: Translate, step: ToolStep): ErrorCard | null => {
  const text = step.status === "failed" && step.view === null ? error_text(t, step) : null;
  if (!text) {
    return null;
  }
  if (command_tools.includes(step.name)) {
    return { kind: "code", label: shell_labels[call_shell(step.name, step.args)], code: text_arg(step, "command"), prompt: true, text };
  }
  if (step.name === "browser_eval") {
    return { kind: "code", label: t("tools.eval_language"), code: text_arg(step, "expression"), prompt: false, text };
  }
  const path = file_card_tools.has(step.name) ? text_arg(step, "path") : "";
  return path ? { kind: "file", path, text } : null;
};

export const shown_error = (t: Translate, step: ToolStep): string | null => (shows_own_error(step.view) || error_card(t, step) ? null : error_text(t, step));

export const offers_background = (step: ToolStep): boolean => step.status === "running" && step.progress?.can_background === true;

const command_arg = (step: ToolStep): string => (typeof step.args.command === "string" ? step.args.command : "");

export const live_command = (step: ToolStep): boolean =>
  is_shell_run(step.name) &&
  step.status === "running" &&
  step.progress !== null &&
  !is_reviewing(step) &&
  (offers_background(step) || Boolean(step.progress.output_tail) || !compact_command(command_arg(step)));

export const opens_by_itself = (step: ToolStep, main_chat: boolean): boolean =>
  !(step.view && collapsed_views.has(step.view.kind)) && step.name !== "view_image" && !is_reviewing(step) && live_draft(step) === null && !(main_chat && is_shell_run(step.name));

export const has_body = (t: Translate, step: ToolStep): boolean =>
  (!is_agent_message(step) || step.status === "failed") &&
  ((is_reviewing(step) && is_command_step(step)) ||
    Boolean(shown_error(t, step)) ||
    error_card(t, step) !== null ||
    Boolean(step.progress?.output_tail) ||
    live_command(step) ||
    live_draft(step) !== null ||
    denial_note(t, step) !== null ||
    step_hooks(step).length > 0 ||
    (step.view ? view_content(t, step, step.view) : step.status !== "denied" && !is_active_status(step.status) && step.result_text !== ""));
