import { useRef } from "react";
import { use_t } from "../../i18n/index.ts";
import { queue_of } from "../../state/chat-drafts.ts";
import { composer_store } from "../../state/composer.ts";
import { use_store } from "../../state/use-store.ts";
import { focus_composer_input, use_chat_busy } from "./composer-hooks.ts";
import { QueuedRow } from "./QueuedRow.tsx";
import { use_leaving_rows } from "./use-leaving-rows.ts";
import "./QueuedList.css";

export const QueuedList = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const list = useRef<HTMLUListElement>(null);
  const queue = use_store(composer_store, (state) => queue_of(state, chat_id));
  const busy = use_chat_busy(chat_id);
  const { rows, finish } = use_leaving_rows(queue);
  if (rows.length === 0) {
    return null;
  }

  const focus_composer = () => {
    if (list.current) {
      focus_composer_input(list.current);
    }
  };

  return (
    <ul ref={list} className="queued-list" aria-label={t("composer.queued_label")} data-leaving={queue.length === 0}>
      {rows.map(({ item, leaving }) => (
        <QueuedRow key={item.id} chat_id={chat_id} entry={item} busy={busy} leaving={leaving} on_left={() => finish(item.id)} on_edited={focus_composer} />
      ))}
    </ul>
  );
};
