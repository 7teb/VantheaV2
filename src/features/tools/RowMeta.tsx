import type { ToolStep } from "../../../shared/chat.ts";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { find_run, type RunRef } from "../../state/agents-reduce.ts";
import { agents_store } from "../../state/agents.ts";
import { background_store } from "../../state/background.ts";
import { use_store } from "../../state/use-store.ts";
import { is_reviewing } from "./review-phase.ts";
import { format_duration, format_elapsed, step_detail, step_duration } from "./tool-summary.ts";

const Detail = ({ text }: { text: string }) => (text ? <span className="tool-row-detail">{text}</span> : null);

type LiveDetailProps = { chat_id: string; step: ToolStep };

const TaskDetail = ({ chat_id, step, task_id }: LiveDetailProps & { task_id: string }) => {
  const t = use_t();
  const status = use_store(background_store, (state) => state.tasks.find((task) => task.id === task_id)?.status ?? null);
  const listed = use_store(background_store, (state) => state.chat_id === chat_id && state.status === "ready");
  return <Detail text={step_detail(t, step, { status, listed })} />;
};

const RunDetail = ({ chat_id, step, run }: LiveDetailProps & { run: RunRef }) => {
  const t = use_t();
  const status = use_store(agents_store, (state) => find_run(state.agents, run)?.run.status ?? null);
  const listed = use_store(agents_store, (state) => state.chat_id === chat_id && state.status === "ready");
  return <Detail text={step_detail(t, step, { status, listed })} />;
};

const StaticDetail = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  return <Detail text={step_detail(t, step)} />;
};

export const RowDetail = ({ chat_id, step }: LiveDetailProps) => {
  const view = step.view;
  if (view?.kind === "background") {
    return <TaskDetail chat_id={chat_id} step={step} task_id={view.task_id} />;
  }
  if (view?.kind === "agent") {
    return <RunDetail chat_id={chat_id} step={step} run={{ agent_id: view.agent_id, run_id: view.run_id }} />;
  }
  return <StaticDetail step={step} />;
};

export const Elapsed = ({ started_at }: { started_at: number }) => {
  const now = use_clock(true);
  const elapsed = Math.max(0, now - started_at);
  const text = format_elapsed(elapsed);
  if (text === null) {
    return null;
  }
  return (
    <span className="tool-row-duration tool-row-elapsed" data-tick={Math.floor(elapsed / 1000) % 2}>
      {text}
    </span>
  );
};

export const CommandTime = ({ step }: { step: ToolStep }) => {
  if (step.status === "running") {
    return step.started_at === null || is_reviewing(step) ? null : <Elapsed started_at={step.started_at} />;
  }
  const duration = step_duration(step);
  if (duration === null || step.status === "denied" || step.view?.kind === "background") {
    return null;
  }
  return <span className="tool-row-duration">{format_duration(duration)}</span>;
};
