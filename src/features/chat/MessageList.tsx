import { Fragment, useMemo } from "react";
import type { Chat } from "../../../shared/chat.ts";
import type { UndoResult } from "../../../shared/ipc/chats.ts";
import { ArrowDownIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { last_assistant } from "../../state/chat-view-reduce.ts";
import { AssistantMessage } from "./AssistantMessage.tsx";
import { last_own_send, plan_state } from "./assistant-blocks.ts";
import { stepless_summary_after, summary_line_step } from "./compaction-line.ts";
import { CompactionRow } from "./StepRows.tsx";
import { use_follow_bottom } from "./use-follow-bottom.ts";
import { UserMessage } from "./UserMessage.tsx";

type MessageListProps = { chat_id: string; chat: Chat; reverted: Record<string, UndoResult> };

export const MessageList = ({ chat_id, chat, reverted }: MessageListProps) => {
  const t = use_t();
  const messages = chat.messages;
  const { scroller, content, away, jump } = use_follow_bottom(last_own_send(messages));
  const plans = useMemo(() => plan_state(messages), [messages]);
  const busy = last_assistant(chat)?.status === "streaming";
  const last_index = messages.length - 1;
  const summary_after = useMemo(() => stepless_summary_after(messages, chat.summary), [messages, chat.summary]);

  return (
    <div className="chat-slot">
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-column" ref={content}>
          {messages.map((message, index) => (
            <Fragment key={message.id}>
              {message.role === "user" ? (
                <UserMessage chat_id={chat_id} message={message} busy={busy} />
              ) : (
                <AssistantMessage
                  chat_id={chat_id}
                  message={message}
                  is_last={index === last_index}
                  busy={busy}
                  last_plan={plans.last_plan_id === message.id}
                  plan_accepted={plans.accepted.has(message.id)}
                  reverted={reverted[message.id] ?? null}
                />
              )}
              {summary_after === message.id && <CompactionRow step={summary_line_step} />}
            </Fragment>
          ))}
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
