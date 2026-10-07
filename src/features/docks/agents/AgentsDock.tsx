import { useEffect } from "react";
import { use_t } from "../../../i18n/index.ts";
import { agents_store, load_agents } from "../../../state/agents.ts";
import { running_runs } from "../../../state/agents-reduce.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { use_clock } from "../../../components/use-clock.ts";
import { AgentList, AgentListSkeleton } from "./AgentList.tsx";
import { TranscriptPanel } from "./TranscriptPanel.tsx";
import "./AgentsDock.css";

export const AgentsDock = ({ visible, chat_id }: DockViewProps) => {
  const t = use_t();
  const status = use_store(agents_store, (state) => state.status);
  const agents = use_store(agents_store, (state) => state.agents);
  const entry = use_store(agents_store, (state) => state.transcript);
  const running = running_runs(agents);
  const live = entry?.status === "ready" && entry.transcript.status === "streaming";
  const now = use_clock(visible && (running > 0 || live));

  useEffect(() => {
    if (visible) {
      void load_agents(chat_id);
    }
  }, [visible, chat_id]);

  if (entry !== null) {
    return <TranscriptPanel entry={entry} agents={agents} now={now} />;
  }

  const meta = () => {
    if (running > 0) {
      return t("agent.running_count", { n: running });
    }
    const runs = agents.reduce((count, agent) => count + agent.runs.length, 0);
    return runs > 0 ? t("agent.finished_count", { n: runs }) : undefined;
  };

  const body = () => {
    if (status === "loading") {
      return <AgentListSkeleton />;
    }
    if (status === "failed") {
      return <DockEmpty text={t("agent.load_failed")} />;
    }
    if (agents.length === 0) {
      return <DockEmpty text={t("agent.none")} />;
    }
    return <AgentList agents={agents} now={now} />;
  };

  return (
    <DockPanel title={<DockTitle label={t("agent.title")} meta={meta()} />} close_label={t("agent.close")}>
      <div className="dock-scroll">{body()}</div>
    </DockPanel>
  );
};
