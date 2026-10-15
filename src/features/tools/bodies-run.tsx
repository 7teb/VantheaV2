import { Button } from "../../components/Button.tsx";
import { BotIcon, CheckIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_agent_run } from "../../state/agents.ts";
import { background_store } from "../../state/background.ts";
import { use_store } from "../../state/use-store.ts";
import { background_status_label } from "./background-status.ts";
import type { BodyProps } from "./body-types.ts";
import { CommandCard } from "./CommandCard.tsx";
import { step_outcome } from "./review-notes.ts";
import { ReviewNotice } from "./ReviewNote.tsx";

const CommandStatus = ({ exit_code, timed_out }: { exit_code: number | null; timed_out: boolean }) => {
  const t = use_t();
  if (timed_out) {
    return <span>{t("tools.command_timed_out")}</span>;
  }
  if (exit_code === null) {
    return null;
  }
  if (exit_code !== 0) {
    return <span>{t("tools.command_exit_code", { n: exit_code })}</span>;
  }
  return (
    <span className="command-card-success">
      <CheckIcon size={12} />
      {t("tools.command_success")}
    </span>
  );
};

export const CommandBody = ({ view, step }: BodyProps<"command">) => {
  const t = use_t();
  const outcome = step_outcome(t, step);
  const in_root = view.cwd === ".";
  const footer = (!in_root || view.timed_out || view.exit_code !== null || outcome.footer.length > 0) && (
    <>
      {!in_root && <span className="command-card-lead">{view.cwd}</span>}
      {outcome.footer.map((text) => (
        <span key={text}>{text}</span>
      ))}
      <CommandStatus exit_code={view.exit_code} timed_out={view.timed_out} />
    </>
  );
  return (
    <CommandCard
      shell={view.shell}
      command={view.command}
      output={view.output || null}
      footer={footer}
      notice={outcome.notice && <ReviewNotice note={outcome.notice} />}
    />
  );
};

export const BackgroundBody = ({ view }: BodyProps<"background">) => {
  const t = use_t();
  const task = use_store(background_store, (state) => state.tasks.find((entry) => entry.id === view.task_id) ?? null);
  return (
    <CommandCard
      shell={view.shell}
      command={view.command}
      output={task?.output_tail ?? view.output_tail}
      footer={
        <>
          <span className="command-card-lead">{view.task_id}</span>
          <span>{background_status_label(t, task?.status ?? view.status)}</span>
        </>
      }
    />
  );
};

export const AgentBody = ({ view }: BodyProps<"agent">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      {view.report && (
        <div className="tool-body-quote">
          <Markdown text={view.report} className="tool-body-markdown" />
        </div>
      )}
      <div className="tool-body-line">
        <Button variant="secondary" icon={<BotIcon size={14} />} onClick={() => open_agent_run({ agent_id: view.agent_id, run_id: view.run_id })}>
          {t("agent.view_transcript")}
        </Button>
      </div>
    </div>
  );
};
