import { memo, useMemo } from "react";
import { Collapsible } from "../../../components/Collapsible.tsx";
import { Markdown } from "../../../components/Markdown.tsx";
import { Skeleton, SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import type { RunRef, Transcript } from "../../../state/agents-reduce.ts";
import { build_blocks, type Block } from "../../chat/assistant-blocks.ts";
import { ReasoningRow } from "../../chat/ReasoningRow.tsx";
import { CompactionRow, NoticeRow, SteerRow } from "../../chat/StepRows.tsx";
import { ErrorCard, RetryBanner } from "../../chat/TurnStatus.tsx";
import { is_active_status } from "../../tools/tool-meta.ts";
import { WorkGroup } from "../../tools/WorkGroup.tsx";

export const TranscriptSkeleton = () => (
  <div className="agent-transcript" aria-busy="true">
    <div className="agent-skeleton-row">
      <Skeleton width={14} height={14} radius={5} />
      <Skeleton width={64} height={12} radius={9} />
    </div>
    {[46, 62].map((width, index) => (
      <div key={index} className="agent-skeleton-row">
        <Skeleton width={14} height={14} radius={5} />
        <Skeleton width={`${width}%`} height={12} radius={5} />
      </div>
    ))}
    <SkeletonLines widths={[94, 88, 71, 52]} height={13} className="agent-skeleton-text" />
    <div className="agent-skeleton-row">
      <Skeleton width={14} height={14} radius={5} />
      <Skeleton width="40%" height={12} radius={5} />
    </div>
  </div>
);

type BlockViewProps = { block: Block; chat_id: string; run: RunRef; streaming: boolean; tail: boolean };

const BlockView = ({ block, chat_id, run, streaming, tail }: BlockViewProps) => {
  switch (block.kind) {
    case "reasoning":
      return <ReasoningRow step={block.step} live={streaming} />;
    case "text":
      return <Markdown text={block.step.text} className="assistant-text" />;
    case "tools":
      return (
        <WorkGroup chat_id={chat_id} run={run} steps={block.steps} running={streaming && (tail || block.steps.some((step) => is_active_status(step.status)))} />
      );
    case "plan":
    case "image":
      return <WorkGroup chat_id={chat_id} run={run} steps={[block.step]} running={streaming && tail} />;
    case "steer":
      return <SteerRow step={block.step} />;
    case "notice":
      return <NoticeRow step={block.step} />;
    case "compaction":
      return <CompactionRow step={block.step} />;
  }
};

const without_report_echo = (blocks: Block[], report: string): Block[] => {
  const last = blocks.at(-1);
  return report && last?.kind === "text" && last.step.text.trim() === report ? blocks.slice(0, -1) : blocks;
};

type AgentTranscriptProps = { transcript: Transcript; chat_id: string; report: string };

export const AgentTranscript = memo(({ transcript, chat_id, report }: AgentTranscriptProps) => {
  const t = use_t();
  const streaming = transcript.status === "streaming";
  const final_report = streaming ? "" : report.trim();
  const blocks = useMemo(() => without_report_echo(build_blocks(transcript.steps), final_report), [transcript.steps, final_report]);
  const run = useMemo(() => ({ agent_id: transcript.agent_id, run_id: transcript.run_id }), [transcript.agent_id, transcript.run_id]);
  const empty = !streaming && blocks.length === 0 && !final_report && !transcript.error;
  return (
    <div className="agent-transcript">
      {transcript.prompt && (
        <Collapsible header={t("agent.prompt")} className="agent-prompt">
          <div className="agent-prompt-body">
            <Markdown text={transcript.prompt} className="agent-prompt-markdown" />
          </div>
        </Collapsible>
      )}
      {blocks.map((block, index) => (
        <BlockView key={block.id} block={block} chat_id={chat_id} run={run} streaming={streaming} tail={index === blocks.length - 1} />
      ))}
      {streaming && blocks.length === 0 && !transcript.retry && (
        <div className="assistant-pending">
          <span className="is-working">{t("chat.thinking")}</span>
        </div>
      )}
      {transcript.retry && <RetryBanner retry={transcript.retry} />}
      {transcript.error && <ErrorCard error={transcript.error} />}
      {empty && <p className="agent-transcript-empty">{t("agent.no_transcript")}</p>}
      {final_report && (
        <section className="agent-report enter-fade-up">
          <h3 className="agent-section-label">{t("agent.report")}</h3>
          <Markdown text={final_report} className="assistant-text" />
        </section>
      )}
    </div>
  );
});
