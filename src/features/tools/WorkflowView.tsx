import type { WorkflowStatus, WorkflowSummary } from "../../../shared/workflow.ts";
import { CheckIcon } from "../../components/icons.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { use_pinned_bottom } from "./use-pinned-bottom.ts";
import { WorkflowAgentRow } from "./WorkflowAgentRow.tsx";
import { counts_line, end_label, phase_groups, type PhaseGroup } from "./workflow-model.ts";
import "./WorkflowView.css";

const WorkflowLogs = ({ summary }: { summary: WorkflowSummary }) => {
  const { scroller, content } = use_pinned_bottom(summary.status === "running");
  return (
    <div ref={scroller} className="workflow-logs">
      <div ref={content} className="workflow-logs-list">
        {summary.logs.map((log, index) => (
          <p key={index} className="workflow-log" data-kind={log.kind}>
            {log.text}
          </p>
        ))}
      </div>
    </div>
  );
};

const PhaseView = ({ run_id, group, now }: { run_id: string; group: PhaseGroup; now: number }) => (
  <section className="workflow-phase">
    {group.title !== null && (
      <div className="workflow-phase-head">
        <span className="workflow-phase-title">{group.title}</span>
        <span className="workflow-phase-count">
          {group.done}/{group.agents.length}
        </span>
        {group.detail && <span className="workflow-phase-detail">{group.detail}</span>}
      </div>
    )}
    <ul className="workflow-agents">
      {group.agents.map((agent) => (
        <WorkflowAgentRow key={agent.index} run_id={run_id} agent={agent} now={now} />
      ))}
    </ul>
  </section>
);

const Outcome = ({ summary }: { summary: WorkflowSummary }) => {
  const t = use_t();
  if (summary.status === "running") {
    return null;
  }
  if (summary.error) {
    return (
      <div className="workflow-message" data-tone={summary.status === "failed" ? "error" : "muted"}>
        {summary.error}
      </div>
    );
  }
  if (summary.status !== "completed" || !summary.result_preview) {
    return null;
  }
  return (
    <div className="workflow-result">
      <div className="workflow-result-head">{t("workflow.return_value")}</div>
      <pre className="workflow-result-text">{summary.result_preview}</pre>
    </div>
  );
};

const EndMark = ({ status }: { status: Exclude<WorkflowStatus, "running"> }) => {
  const t = use_t();
  return (
    <span className="workflow-end" data-status={status}>
      {status === "completed" && <CheckIcon size={12} />}
      {end_label(t, status)}
    </span>
  );
};

export const WorkflowView = ({ summary }: { summary: WorkflowSummary }) => {
  const t = use_t();
  const running = summary.status === "running";
  const now = use_clock(running);
  const groups = phase_groups(summary);
  return (
    <div className="workflow-view" data-status={summary.status}>
      {summary.logs.length > 0 && <WorkflowLogs summary={summary} />}
      {groups.length > 0 && (
        <div className="workflow-tree">
          {groups.map((group) => (
            <PhaseView key={group.key} run_id={summary.run_id} group={group} now={now} />
          ))}
        </div>
      )}
      <Outcome summary={summary} />
      <div className="workflow-foot">
        <span className="workflow-foot-lead">{counts_line(t, summary.counts)}</span>
        {summary.status !== "running" && <EndMark status={summary.status} />}
      </div>
    </div>
  );
};

export const WorkflowSkeleton = () => (
  <div className="workflow-view" aria-busy="true">
    <div className="workflow-tree">
      {[58, 76, 44].map((width, index) => (
        <div key={index} className="workflow-skeleton-row">
          <Skeleton width={14} height={14} radius={7} />
          <Skeleton width={`${width}%`} height={12} radius={5} />
        </div>
      ))}
    </div>
    <div className="workflow-foot">
      <Skeleton width={120} height={12} radius={5} />
    </div>
  </div>
);
