import { memo, useState } from "react";
import type { UserMessage as UserMessageData } from "../../../shared/chat.ts";
import { IconButton } from "../../components/Button.tsx";
import { ForkIcon, PencilIcon } from "../../components/icons.tsx";
import { CopyButton } from "../../components/MarkdownCopy.tsx";
import { use_t } from "../../i18n/index.ts";
import { fork_chat } from "../../state/chat-actions.ts";
import { UserAttachments } from "./UserAttachments.tsx";
import { UserEditor } from "./UserEditor.tsx";
import { OriginNote } from "./OriginNote.tsx";
import "./UserMessage.css";

type UserMessageProps = { chat_id: string; message: UserMessageData; busy: boolean };

export const UserMessage = memo(({ chat_id, message, busy }: UserMessageProps) => {
  const t = use_t();
  const [editing, set_editing] = useState(false);
  const [error, set_error] = useState("");

  if (message.origin !== "user") {
    return <OriginNote message={message} />;
  }

  const fork = async () => {
    const result = await fork_chat(chat_id, message.id);
    set_error(result.ok ? "" : result.error);
  };

  return (
    <div className="user-message enter-fade-up">
      {message.attachments.length > 0 && <UserAttachments attachments={message.attachments} />}
      {editing ? (
        <UserEditor chat_id={chat_id} message={message} on_done={() => set_editing(false)} />
      ) : (
        message.text && <div className="user-bubble inset-surface">{message.text}</div>
      )}
      {!editing && (
        <div className="message-actions">
          {message.text && <CopyButton text={message.text} className="message-action" />}
          <IconButton label={t("chat.edit")} size="sm" className="message-action" disabled={busy} onClick={() => set_editing(true)}>
            <PencilIcon size={15} />
          </IconButton>
          <IconButton label={t("chat.fork")} size="sm" className="message-action" onClick={() => void fork()}>
            <ForkIcon size={15} />
          </IconButton>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
});
