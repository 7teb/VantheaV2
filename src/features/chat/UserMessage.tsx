import { memo, useState } from "react";
import type { UserMessage as UserMessageData, UserOrigin } from "../../../shared/chat.ts";
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

const command_text: Partial<Record<UserOrigin, string>> = { init: "/init", git_init: "/gitinit", review: "/review" };

export const UserMessage = memo(({ chat_id, message, busy }: UserMessageProps) => {
  const t = use_t();
  const [editing, set_editing] = useState(false);
  const [error, set_error] = useState("");

  const command = command_text[message.origin];
  if (message.origin !== "user" && !command) {
    return <OriginNote message={message} />;
  }
  const command_line = command && message.command_arg ? `${command} ${message.command_arg}` : command;
  const shown = command_line ?? message.text;

  const fork = async () => {
    const result = await fork_chat(chat_id, message.id);
    set_error(result.ok ? "" : result.error);
  };

  return (
    <div className="user-message enter-fade-up" data-editing={editing || undefined}>
      {message.attachments.length > 0 && <UserAttachments attachments={message.attachments} />}
      {editing ? (
        <UserEditor chat_id={chat_id} message={message} on_done={() => set_editing(false)} />
      ) : (
        shown && <div className="user-bubble inset-surface">{shown}</div>
      )}
      {!editing && (
        <div className="message-actions">
          {shown && <CopyButton text={shown} />}
          {!command && (
            <IconButton label={t("chat.edit")} size="sm" disabled={busy} onClick={() => set_editing(true)}>
              <PencilIcon size={14} />
            </IconButton>
          )}
          <IconButton label={t("chat.fork")} size="sm" onClick={() => void fork()}>
            <ForkIcon size={14} />
          </IconButton>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
});
