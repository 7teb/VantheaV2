import { useEffect } from "react";
import { Button } from "../../components/Button.tsx";
import { use_t } from "../../i18n/index.ts";
import { chat_view_store, load_chat, open_chat_view } from "../../state/chat-view.ts";
import { use_store } from "../../state/use-store.ts";
import { ChatSkeleton } from "./ChatSkeleton.tsx";
import { MessageList } from "./MessageList.tsx";
import "./ChatSlot.css";

export type ChatSlotProps = { chat_id: string };

export const ChatSlot = ({ chat_id }: ChatSlotProps) => {
  const t = use_t();
  const entry = use_store(chat_view_store, (state) => state.entries[chat_id]);

  useEffect(() => {
    open_chat_view(chat_id);
  }, [chat_id]);

  if (entry?.status === "failed") {
    return (
      <div className="chat-slot chat-slot-failed">
        <p>{t("chat.load_failed")}</p>
        <Button variant="secondary" onClick={() => void load_chat(chat_id)}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!entry?.chat) {
    return <ChatSkeleton />;
  }

  return <MessageList chat_id={chat_id} chat={entry.chat} reverted={entry.reverted} />;
};
