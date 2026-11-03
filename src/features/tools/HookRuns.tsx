import type { ToolStep } from "../../../shared/chat.ts";
import type { HookRun } from "../../../shared/hook-notes.ts";
import { call_shell, command_tools, shell_labels } from "../../../shared/shell.ts";
import { use_t } from "../../i18n/index.ts";
import { CommandStatus } from "./bodies-run.tsx";
import { CommandCard, CommandText } from "./CommandCard.tsx";
import { run_empty, run_lead } from "./hook-runs.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { format_duration } from "./tool-summary.ts";
import "./hooks.css";

const RunStatus = ({ run }: { run: HookRun }) => {
  const t = use_t();
  if (run.status !== "error") {
    return null;
  }
  if (run.failure === "timeout") {
    return <CommandStatus exit_code={null} timed_out />;
  }
  if (run.failure === "start") {
    return <span>{t("hooks.status_start")}</span>;
  }
  if (run.failure === "json") {
    return <span>{t("hooks.status_json")}</span>;
  }
  return <CommandStatus exit_code={run.exit_code} timed_out={false} />;
};

const RunOutput = ({ run }: { run: HookRun }) => {
  const t = use_t();
  const empty = run_empty(run);
  if (run.text.trim()) {
    return <OutputBlock text={run.text} />;
  }
  if (empty === "reason") {
    return <div className="command-card-empty">{t("hooks.no_reason")}</div>;
  }
  return empty === "output" ? <div className="command-card-empty">{t("tools.no_output")}</div> : null;
};

export const HookRunCard = ({ run }: { run: HookRun }) => {
  const t = use_t();
  return (
    <div className="command-card hook-run-card" data-status={run.status}>
      <div className="command-card-shell">{t("hooks.card_head", { x: shell_labels[run.shell] })}</div>
      <CommandText command={run.command} />
      <RunOutput run={run} />
      <div className="command-card-footer">
        <span className="command-card-lead">{t(run_lead(run))}</span>
        <RunStatus run={run} />
        {run.failure !== "start" && <span>{format_duration(run.duration_ms)}</span>}
      </div>
    </div>
  );
};

export const HookRuns = ({ runs }: { runs: HookRun[] }) => (
  <div className="hook-runs">
    {runs.map((run, at) => (
      <HookRunCard key={`${run.hook_id}:${at}`} run={run} />
    ))}
  </div>
);

export const BlockedCall = ({ step }: { step: ToolStep }) => {
  const command = typeof step.args.command === "string" ? step.args.command : "";
  if (!command_tools.includes(step.name) || !command) {
    return null;
  }
  return <CommandCard shell={shell_labels[call_shell(step.name, step.args)]} command={command} output={null} footer={null} />;
};
