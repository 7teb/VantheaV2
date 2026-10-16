import { memo, useState, type ReactNode } from "react";
import { manual_compaction_only } from "../../../shared/chat.ts";
import { IconButton } from "../../components/Button.tsx";
import { ForkIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CopyButton } from "../../components/MarkdownCopy.tsx";
import { use_t } from "../../i18n/index.ts";
import { fork_chat } from "../../state/chat-actions.ts";
import { ImageBody } from "../tools/bodies-web.tsx";
import { tool_icon } from "../tools/registry.tsx";
import { tool_label } from "../tools/tool-meta.ts";
import { WorkGroup } from "../tools/WorkGroup.tsx";
import { answer_text, shows_thinking, type Block } from "./assistant-blocks.ts";
import { PlanCard } from "./PlanCard.tsx";
import { ReasoningRow } from "./ReasoningRow.tsx";
import { CompactionRow, NoticeRow, SteerRow } from "./StepRows.tsx";
import { FoldItem } from "./TurnFold.tsx";
import { foldable_block, type MemberFacts } from "./turn-shape.ts";
import { RetryBanner, TurnOutcome } from "./TurnStatus.tsx";

type BlockViewProps = {
  block: Block;
  chat_id: string;
  message_id: string;
  streaming: boolean;
  tail: boolean;
  can_accept: boolean;
  accepted: boolean;
};

const ImageStep = ({ block }: { block: Extract<Block, { kind: "image" }> }) => {
  const t = use_t();
  const Icon = tool_icon(block.step);
  return (
    <div className="image-step">
      <div className="image-step-head">
        <Icon size={14} />
        <span>{tool_label(t, block.step)}</span>
      </div>
      <ImageBody view={block.view} step={block.step} />
    </div>
  );
};

const BlockView = ({ block, chat_id, message_id, streaming, tail, can_accept, accepted }: BlockViewProps) => {
  switch (block.kind) {
    case "reasoning":
      return <ReasoningRow step={block.step} live={streaming} />;
    case "text":
      return <Markdown text={block.step.text} className="assistant-text" />;
    case "tools":
      return <WorkGroup chat_id={chat_id} steps={block.steps} streaming={streaming} tail={tail} />;
    case "plan":
      return <PlanCard chat_id={chat_id} message_id={message_id} text={block.text} can_accept={can_accept} accepted={accepted} />;
    case "image":
      return <ImageStep block={block} />;
    case "steer":
      return <SteerRow step={block.step} />;
    case "notice":
      return <NoticeRow step={block.step} />;
    case "compaction":
      return <CompactionRow step={block.step} />;
  }
};

type TurnBodyProps = {
  chat_id: string;
  facts: MemberFacts;
  folds: ReadonlySet<string>;
  folded: boolean;
  final: boolean;
  is_last: boolean;
  busy: boolean;
  last_plan: boolean;
  plan_accepted: boolean;
  file_card: ReactNode;
};

export const TurnBody = memo(({ chat_id, facts, folds, folded, final, is_last, busy, last_plan, plan_accepted, file_card }: TurnBodyProps) => {
  const t = use_t();
  const { message, blocks } = facts;
  const streaming = message.status === "streaming";
  const [fork_error, set_fork_error] = useState("");
  const fork = async () => {
    const result = await fork_chat(chat_id, message.id);
    set_fork_error(result.ok ? "" : result.error);
  };
  const answer = answer_text(message);
  const outcome = (
    <>
      {message.retry && <RetryBanner retry={message.retry} />}
      {!manual_compaction_only(message) && <TurnOutcome chat_id={chat_id} message={message} has_content={blocks.length > 0} can_continue={is_last && !busy} />}
    </>
  );
  return (
    <>
      {blocks.map((block, index) => {
        const view = (
          <BlockView
            key={block.id}
            block={block}
            chat_id={chat_id}
            message_id={message.id}
            streaming={streaming}
            tail={index === blocks.length - 1}
            can_accept={last_plan && !busy}
            accepted={plan_accepted}
          />
        );
        return foldable_block(block) ? (
          <FoldItem key={block.id} folded={folded && folds.has(block.id)}>
            {view}
          </FoldItem>
        ) : (
          view
        );
      })}
      {shows_thinking(streaming, message.retry !== null, blocks) && (
        <div className="assistant-pending">
          <span className="is-working">{t("chat.thinking")}</span>
        </div>
      )}
      {final ? outcome : <FoldItem folded={folded}>{outcome}</FoldItem>}
      {final && file_card}
      {final && !streaming && !manual_compaction_only(message) && (
        <div className="message-actions assistant-actions">
          {answer && <CopyButton text={answer} label={t("chat.copy_answer")} />}
          <IconButton label={t("chat.fork")} size="sm" onClick={() => void fork()}>
            <ForkIcon size={14} />
          </IconButton>
        </div>
      )}
      {fork_error && <div className="inline-error">{fork_error}</div>}
    </>
  );
});
