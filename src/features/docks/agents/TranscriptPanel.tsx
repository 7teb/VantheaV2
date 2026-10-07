import { useState } from "react";
import type { AgentSummary } from "../../../../shared/ipc/work.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { ArrowLeftIcon, CircleStopIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { cancel_agent, close_agent_run } from "../../../state/agents.ts";
import { find_run, run_status_of, type TranscriptEntry } from "../../../state/agents-reduce.ts";
import { use_follow_bottom } from "../../chat/use-follow-bottom.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { run_duration, status_labels } from "./agent-meta.ts";
import { AgentTranscript, TranscriptSkeleton } from "./AgentTranscript.tsx";

type TranscriptPanelProps = { entry: TranscriptEntry; agents: AgentSummary[]; now: number };

export const TranscriptPanel = ({ entry, agents, now }: TranscriptPanelProps) => {
  const t = use_t();
  const { scroller, content } = use_follow_bottom(entry.request);
  const [stopping, set_stopping] = useState(false);
  const [error, set_error] = useState("");
  const found = find_run(agents, entry);
  const transcript = entry.status === "ready" ? entry.transcript : null;
  const timing = found?.run ?? transcript;
  const status = found?.run.status ?? (transcript ? run_status_of(transcript.status) : null);
  const name = found?.agent.name || transcript?.name || t("agent.transcript");
  const meta = status && timing ? `${t(status_labels[status])} · ${run_duration(timing, now)}` : undefined;

  const stop = async () => {
    set_stopping(true);
    const result = await cancel_agent(entry.agent_id);
    set_error(result.ok ? "" : result.error);
    set_stopping(false);
  };

  const body = () => {
    if (entry.status === "loading") {
      return <TranscriptSkeleton />;
    }
    if (entry.status === "failed") {
      return <DockEmpty text={t("agent.transcript_failed")} />;
    }
    return <AgentTranscript transcript={entry.transcript} chat_id={entry.chat_id} report={found?.run.report || entry.transcript.report} />;
  };

  return (
    <DockPanel
      title={
        <div className="agent-head">
          <IconButton label={t("agent.back")} onClick={close_agent_run}>
            <ArrowLeftIcon size={16} />
          </IconButton>
          <DockTitle label={name} meta={meta} />
        </div>
      }
      close_label={t("agent.close")}
      actions={
        status === "running" && (
          <Button variant="ghost" icon={<CircleStopIcon size={14} />} disabled={stopping} onClick={() => void stop()}>
            {t("agent.stop")}
          </Button>
        )
      }
    >
      {error && <div className="agent-panel-error">{error}</div>}
      <div ref={scroller} className="dock-scroll agent-scroll">
        <div ref={content}>{body()}</div>
      </div>
    </DockPanel>
  );
};
