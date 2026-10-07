import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { UserMessage } from "../../../shared/chat.ts";
import { Button } from "../../components/Button.tsx";
import { use_t } from "../../i18n/index.ts";
import { edit_message } from "../../state/chat-actions.ts";

type UserEditorProps = { chat_id: string; message: UserMessage; on_done: () => void };

const max_editor_px = 320;

export const UserEditor = ({ chat_id, message, on_done }: UserEditorProps) => {
  const t = use_t();
  const [text, set_text] = useState(message.text);
  const [sending, set_sending] = useState(false);
  const [error, set_error] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = area.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    if (text === "") {
      return;
    }
    node.style.height = `${Math.min(node.scrollHeight, max_editor_px)}px`;
  }, [text]);

  useLayoutEffect(() => {
    const node = area.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, []);

  const resend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) {
      return;
    }
    set_sending(true);
    const result = await edit_message(chat_id, message.id, trimmed);
    if (result.ok) {
      on_done();
      return;
    }
    set_error(result.error);
    set_sending(false);
  };

  const on_key_down = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      on_done();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void resend();
    }
  };

  return (
    <div className="user-editor inset-surface">
      <textarea ref={area} rows={1} value={text} onChange={(event) => set_text(event.target.value)} onKeyDown={on_key_down} spellCheck={false} />
      <div className="user-editor-bar">
        {error && <span className="inline-error">{error}</span>}
        <Button variant="ghost" onClick={on_done}>
          {t("chat.edit_cancel")}
        </Button>
        <Button variant="secondary" disabled={sending || !text.trim()} onClick={() => void resend()}>
          {t("chat.edit_resend")}
        </Button>
      </div>
    </div>
  );
};
