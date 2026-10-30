import { useEffect, useMemo } from "react";
import { IconButton } from "../../../components/Button.tsx";
import { Collapsible } from "../../../components/Collapsible.tsx";
import { TrashIcon } from "../../../components/icons.tsx";
import { Skeleton, SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_clock } from "../../../components/use-clock.ts";
import { use_t } from "../../../i18n/index.ts";
import { agents_store, load_agents } from "../../../state/agents.ts";
import { background_store, clear_finished_tasks, load_background } from "../../../state/background.ts";
import { toggle_task_section, ui_store, type TaskSection } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import { list_status } from "../../../state/workflows-reduce.ts";
import { workflows_store } from "../../../state/workflows.ts";
import { AgentEntry } from "../agents/AgentEntry.tsx";
import { TranscriptPanel } from "../agents/TranscriptPanel.tsx";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { BackgroundTaskRow } from "./BackgroundTaskRow.tsx";
import { group_tasks, type TaskEntry } from "./task-groups.ts";
import { WorkflowEntry } from "./WorkflowEntry.tsx";
import { WorkflowPanel } from "./WorkflowPanel.tsx";
import "./BackgroundDock.css";

const BackgroundSkeleton = () => (
  <div className="bg-section" aria-busy="true">
    <div className="bg-section-skeleton">
      <Skeleton width={56} height={9} radius={4} />
    </div>
    <div className="bg-section-list">
      {[64, 82, 48].map((width, index) => (
        <div key={index} className="bg-task">
          <div className="bg-task-head">
            <Skeleton width={15} height={15} radius={8} />
            <Skeleton width={`${width}%`} height={12} radius={4} />
          </div>
          <SkeletonLines widths={[36]} height={10} />
        </div>
      ))}
    </div>
  </div>
);

type TaskSectionListProps = { section: TaskSection; label: string; entries: TaskEntry[]; now: number };

const TaskSectionList = ({ section, label, entries, now }: TaskSectionListProps) => {
  const collapsed = use_store(ui_store, (state) => state.collapsed_task_sections.includes(section));
  if (entries.length === 0) {
    return null;
  }
  return (
    <Collapsible
      className="bg-section"
      open={!collapsed}
      on_toggle={() => toggle_task_section(section)}
      header={
        <>
          <span className="section-label">{label}</span>
          <span className="bg-section-count">{entries.length}</span>
        </>
      }
    >
      <div className="bg-section-list">
        {entries.map((entry) => {
          switch (entry.kind) {
            case "agent":
              return <AgentEntry key={entry.agent.agent_id} agent={entry.agent} now={now} />;
            case "workflow":
              return <WorkflowEntry key={entry.summary.run_id} summary={entry.summary} now={now} />;
            case "shell":
              return <BackgroundTaskRow key={entry.task.id} task={entry.task} now={now} />;
          }
        })}
      </div>
    </Collapsible>
  );
};

export const BackgroundDock = ({ visible, chat_id }: DockViewProps) => {
  const t = use_t();
  const agents_status = use_store(agents_store, (state) => state.status);
  const agents = use_store(agents_store, (state) => state.agents);
  const entry = use_store(agents_store, (state) => state.transcript);
  const tasks_status = use_store(background_store, (state) => state.status);
  const tasks = use_store(background_store, (state) => state.tasks);
  const runs = use_store(workflows_store, (state) => state.runs);
  const open_run = use_store(workflows_store, (state) => state.open);
  const workflows_failed = use_store(workflows_store, (state) => chat_id !== null && list_status(state, chat_id) === "failed");
  const workflows = useMemo(() => Object.values(runs), [runs]);
  const groups = useMemo(() => group_tasks(agents, tasks, workflows), [agents, tasks, workflows]);
  const live = entry?.status === "ready" && entry.transcript.status === "streaming";
  const now = use_clock(visible && (groups.running.length > 0 || live));
  const clearable = tasks.some((task) => task.status !== "running");

  useEffect(() => {
    if (visible) {
      void load_agents(chat_id);
      void load_background(chat_id);
    }
  }, [visible, chat_id]);

  if (entry !== null) {
    return <TranscriptPanel entry={entry} agents={agents} now={now} />;
  }

  if (open_run !== null) {
    return <WorkflowPanel summary={runs[open_run] ?? null} failed={workflows_failed} now={now} />;
  }

  const body = () => {
    if (agents_status === "loading" || tasks_status === "loading") {
      return <BackgroundSkeleton />;
    }
    const failures = [
      ...(agents_status === "failed" ? [t("agent.load_failed")] : []),
      ...(tasks_status === "failed" ? [t("background.load_failed")] : []),
    ];
    if (groups.running.length === 0 && groups.finished.length === 0) {
      return failures.length > 0 ? failures.map((text) => <DockEmpty key={text} text={text} />) : <DockEmpty text={t("background.none")} />;
    }
    return (
      <>
        {failures.map((text) => (
          <p key={text} className="bg-load-failed">
            {text}
          </p>
        ))}
        <TaskSectionList section="running" label={t("background.section_running")} entries={groups.running} now={now} />
        <TaskSectionList section="finished" label={t("background.section_finished")} entries={groups.finished} now={now} />
      </>
    );
  };

  return (
    <DockPanel
      title={<DockTitle label={t("background.title")} />}
      close_label={t("background.close")}
      actions={
        clearable &&
        chat_id !== null && (
          <IconButton label={t("background.clear_finished")} onClick={() => void clear_finished_tasks(chat_id)}>
            <TrashIcon size={16} />
          </IconButton>
        )
      }
    >
      <div className="dock-scroll">{body()}</div>
    </DockPanel>
  );
};
