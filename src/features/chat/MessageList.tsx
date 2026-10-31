import { Fragment, useMemo } from "react";
import type { Chat } from "../../../shared/chat.ts";
import { undoable_turn } from "../../../shared/file-changes.ts";
import { ArrowDownIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { last_assistant } from "../../state/chat-view-reduce.ts";
import { regenerable_turn, turn_segments } from "../../state/turn-groups.ts";
import { AssistantMessage } from "./AssistantMessage.tsx";
import { last_own_send, plan_state } from "./assistant-blocks.ts";
import { stepless_summary_after, summary_line_step } from "./compaction-line.ts";
import { CompactionRow } from "./StepRows.tsx";
import { use_follow_bottom } from "./use-follow-bottom.ts";
import { UserMessage } from "./UserMessage.tsx";

type MessageListProps = { chat_id: string; chat: Chat };

export const MessageList = ({ chat_id, chat }: MessageListProps) => {
  const t = use_t();
  const messages = chat.messages;
  const { scroller, content, away, jump } = use_follow_bottom(last_own_send(messages));
  const plans = useMemo(() => plan_state(messages), [messages]);
  const undoable_id = useMemo(() => undoable_turn(messages)?.id ?? null, [messages]);
  const segments = useMemo(() => turn_segments(messages), [messages]);
  const regenerable = useMemo(() => regenerable_turn(segments), [segments]);
  const busy = last_assistant(chat)?.status === "streaming";
  const last_id = messages.at(-1)?.id ?? "";
  const summary_after = useMemo(() => stepless_summary_after(messages, chat.summary), [messages, chat.summary]);

  return (
    <div className="chat-slot">
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-column" ref={content}>
          {segments.map((segment) =>
            segment.kind === "user" ? (
              <Fragment key={segment.message.id}>
                <UserMessage chat_id={chat_id} message={segment.message} busy={busy} />
                {summary_after === segment.message.id && <CompactionRow step={summary_line_step} />}
              </Fragment>
            ) : (
              <AssistantMessage
                key={segment.messages[0]?.id}
                chat_id={chat_id}
                messages={segment.messages}
                last_id={last_id}
                busy={busy}
                last_plan_id={plans.last_plan_id}
                accepted={plans.accepted}
                undoable_id={undoable_id}
                summary_after={summary_after}
                retry_from={segment === segments.at(-1) ? regenerable : null}
              />
            ),
          )}
        </div>
      </div>
      {away && (
        <button type="button" className="jump-latest raised-surface" onClick={jump}>
          <ArrowDownIcon size={14} />
          <span>{t("composer.jump_latest")}</span>
        </button>
      )}
    </div>
  );
};
