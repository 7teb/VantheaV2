import { memo, useState } from "react";
import type { HookNote } from "../../../shared/hook-notes.ts";
import type { HookEvent } from "../../../shared/hooks.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CircleAlertIcon, HookIcon, ShieldTerminalIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { HookRuns } from "../tools/HookRuns.tsx";
import "../tools/tools.css";
import "./AgentNoteRow.css";

type Outcome = "blocked" | "context" | "error";

const labels: Record<HookEvent, Record<Outcome, MessageKey>> = {
  UserPromptSubmit: { blocked: "hooks.note_prompt_blocked", context: "hooks.note_prompt_context", error: "hooks.note_prompt" },
  PreToolUse: { blocked: "hooks.body_output", context: "hooks.body_output", error: "hooks.body_output" },
  PostToolUse: { blocked: "hooks.body_output", context: "hooks.body_output", error: "hooks.body_output" },
  PostToolUseFailure: { blocked: "hooks.body_output", context: "hooks.body_output", error: "hooks.body_output" },
  Stop: { blocked: "hooks.note_stop_continued", context: "hooks.note_stop_continued", error: "hooks.note_stop" },
  StopFailure: { blocked: "hooks.note_stop_failure", context: "hooks.note_stop_failure", error: "hooks.note_stop_failure" },
  SubagentStart: { blocked: "hooks.note_agent_start", context: "hooks.note_agent_start_context", error: "hooks.note_agent_start" },
  SubagentStop: { blocked: "hooks.note_agent_stop_continued", context: "hooks.note_agent_stop_continued", error: "hooks.note_agent_stop" },
};

const outcome_of = (note: HookNote): Outcome => {
  if (note.runs.some((run) => run.status === "blocked")) {
    return "blocked";
  }
  return note.runs.some((run) => run.status === "context") ? "context" : "error";
};

export const HookNoteRow = memo(({ note }: { note: HookNote }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const outcome = outcome_of(note);
  const blocked_message = note.event === "UserPromptSubmit" && outcome === "blocked";
  const failed = note.runs.some((run) => run.status === "error");
  if (open && !seen) {
    set_seen(true);
  }
  return (
    <div className="agent-note tool-row enter-fade-up" data-status={blocked_message ? "denied" : "done"} data-open={open}>
      <button type="button" className="tool-row-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">{blocked_message ? <ShieldTerminalIcon /> : <HookIcon />}</span>
        <span className="tool-row-label">{t(labels[note.event][outcome])}</span>
        {failed && (
          <span className="tool-row-status is-failed" title={t("tools.status_failed")}>
            <CircleAlertIcon />
          </span>
        )}
        <ChevronRightIcon className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div className="tool-row-body">
          {seen && (
            <div className="tool-body">
              {note.prompt && <div className="tool-body-quote">{note.prompt}</div>}
              <HookRuns runs={note.runs} />
            </div>
          )}
        </div>
      </CollapsibleBody>
    </div>
  );
});
