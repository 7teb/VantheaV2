import { IconButton } from "../../components/Button.tsx";
import { CloseIcon, CornerDownRightIcon, PaperclipIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { queue_of } from "../../state/chat-drafts.ts";
import { composer_store, discard_queued, send_queued, steer_queued } from "../../state/composer.ts";
import { use_store } from "../../state/use-store.ts";
import { use_chat_busy } from "./composer-hooks.ts";

export const QueuedList = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const queue = use_store(composer_store, (state) => queue_of(state, chat_id));
  const busy = use_chat_busy(chat_id);
  if (queue.length === 0) {
    return null;
  }
  return (
    <ul className="queued-list" aria-label={t("composer.queued_label")}>
      {queue.map((entry) => (
        <li key={entry.id} className="queued-item enter-fade-up" data-steering={entry.steering}>
          <CornerDownRightIcon size={14} className="queued-mark" />
          <span className="queued-text" title={entry.text}>{entry.text}</span>
          {entry.attachments.length > 0 && (
            <span className="queued-meta">
              <PaperclipIcon size={12} />
              {entry.attachments.length}
            </span>
          )}
          {(entry.steering || entry.steer_failed) && (
            <span className="queued-state" role="status" title={t(entry.steering ? "composer.queued_waiting_hint" : "composer.queued_not_sent_hint")}>
              {t(entry.steering ? "composer.queued_waiting" : "composer.queued_not_sent")}
            </span>
          )}
          {(busy || entry.steering) && (
            <button type="button" className="queued-action" disabled={entry.steering} title={t(entry.steering ? "composer.queued_waiting_hint" : "composer.queued_steer_hint")} onClick={() => void steer_queued(chat_id, entry.id)}>
              {t("composer.queued_steer")}
            </button>
          )}
          {!entry.steering && !busy && (
            <button type="button" className="queued-action" onClick={() => void send_queued(chat_id, entry.id)}>
              {t("composer.queued_send")}
            </button>
          )}
          <IconButton label={t("composer.queued_discard")} size="sm" disabled={entry.steering} onClick={() => discard_queued(chat_id, entry.id)}>
            <CloseIcon size={13} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
};
