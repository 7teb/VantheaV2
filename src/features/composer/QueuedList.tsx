import { useRef, useState } from "react";
import { use_t } from "../../i18n/index.ts";
import { queue_of, type QueuedMessage } from "../../state/chat-drafts.ts";
import { composer_store } from "../../state/composer.ts";
import { use_store } from "../../state/use-store.ts";
import { focus_composer_input, use_chat_busy } from "./composer-hooks.ts";
import { drop_leaving, shown_rows, track_leaving, type LeavingRow } from "./leaving-rows.ts";
import { QueuedRow } from "./QueuedRow.tsx";
import "./QueuedList.css";

type Tracked = { queue: QueuedMessage[]; leaving: LeavingRow<QueuedMessage>[] };

const use_leaving_rows = (queue: QueuedMessage[]) => {
  const [tracked, set_tracked] = useState<Tracked>({ queue, leaving: [] });
  let current = tracked;
  if (tracked.queue !== queue) {
    current = { queue, leaving: track_leaving(tracked.queue, queue, tracked.leaving) };
    set_tracked(current);
  }
  const finish = (id: string) => set_tracked((state) => ({ ...state, leaving: drop_leaving(state.leaving, id) }));
  return { rows: shown_rows(queue, current.leaving), finish };
};

export const QueuedList = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const panel = useRef<HTMLDivElement>(null);
  const queue = use_store(composer_store, (state) => queue_of(state, chat_id));
  const busy = use_chat_busy(chat_id);
  const { rows, finish } = use_leaving_rows(queue);
  if (rows.length === 0) {
    return null;
  }

  const focus_composer = () => {
    if (panel.current) {
      focus_composer_input(panel.current);
    }
  };

  return (
    <div ref={panel} className="queued-panel raised-surface enter-fade-up" data-leaving={queue.length === 0}>
      <ul className="queued-list" aria-label={t("composer.queued_label")}>
        {rows.map(({ item, leaving }) => (
          <QueuedRow key={item.id} chat_id={chat_id} entry={item} busy={busy} leaving={leaving} on_left={() => finish(item.id)} on_edited={focus_composer} />
        ))}
      </ul>
    </div>
  );
};
