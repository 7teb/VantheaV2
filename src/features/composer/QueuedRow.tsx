import { useState, type AnimationEvent } from "react";
import type { Attachment } from "../../../shared/chat.ts";
import { IconButton } from "../../components/Button.tsx";
import { CircleAlertIcon, CornerDownRightIcon, CircleSpinnerIcon, MoreHorizontalIcon, PaperclipIcon, PencilIcon, QueueIcon, TrashIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import type { QueuedMessage } from "../../state/chat-drafts.ts";
import { discard_queued, edit_queued, send_queued, steer_queued } from "../../state/composer.ts";
import { attachment_thumb_src } from "../chat/media.ts";

const images_text = (t: Translate, images: Attachment[]): string => {
  if (images.length === 0) {
    return "";
  }
  return images.length === 1 ? t("composer.queued_image") : t("composer.queued_images", { n: images.length });
};

const RowIcon = ({ entry }: { entry: QueuedMessage }) => {
  const t = use_t();
  if (entry.steering) {
    return (
      <span className="queued-icon">
        <CircleSpinnerIcon size={14} className="spin" />
      </span>
    );
  }
  if (entry.steer_failed) {
    return (
      <Tooltip label={t("composer.queued_not_sent_hint")}>
        <span className="queued-icon" data-tone="warning" role="img" aria-label={t("composer.queued_not_sent")}>
          <CircleAlertIcon size={14} />
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="queued-icon">
      <QueueIcon size={14} className="queued-mark" />
    </span>
  );
};

const RowStatus = ({ entry }: { entry: QueuedMessage }) => {
  const t = use_t();
  if (entry.steering) {
    return (
      <Tooltip label={t("composer.queued_waiting_hint")}>
        <span className="queued-state" role="status">
          {t("composer.queued_waiting")}
        </span>
      </Tooltip>
    );
  }
  if (entry.after_compaction) {
    return (
      <span className="queued-state" role="status">
        {t("composer.queued_after_compaction")}
      </span>
    );
  }
  return null;
};

type QueuedRowProps = {
  chat_id: string;
  entry: QueuedMessage;
  busy: boolean;
  leaving: boolean;
  on_left: () => void;
  on_edited: () => void;
};

export const QueuedRow = ({ chat_id, entry, busy, leaving, on_left, on_edited }: QueuedRowProps) => {
  const t = use_t();
  const [more_anchor, set_more_anchor] = useState<HTMLButtonElement | null>(null);
  const [menu_open, set_menu_open] = useState(false);
  const images = entry.attachments.filter((attachment) => attachment.kind === "image");
  const files = entry.attachments.length - images.length;
  const text = entry.text || images_text(t, images);
  const steer = busy || Boolean(entry.after_compaction);

  const on_animation_end = (event: AnimationEvent<HTMLLIElement>) => {
    if (leaving && event.target === event.currentTarget) {
      on_left();
    }
  };

  const steer_button = (
    <button
      type="button"
      className="queued-steer"
      disabled={entry.after_compaction}
      onClick={() => void (steer ? steer_queued(chat_id, entry.id) : send_queued(chat_id, entry.id))}
    >
      <CornerDownRightIcon size={14} />
      {t(steer ? "composer.queued_steer" : "composer.queued_send")}
    </button>
  );

  return (
    <li className="queued-row" data-steering={entry.steering} data-leaving={leaving} inert={leaving} onAnimationEnd={on_animation_end}>
      <div className="queued-row-inner">
        <span className="queued-lead">
          <RowIcon entry={entry} />
          {images[0] && <img className="queued-thumb" src={attachment_thumb_src(images[0])} alt="" />}
          <span className="queued-text" title={text}>
            {text}
          </span>
          {files > 0 && (
            <span className="queued-meta">
              <PaperclipIcon size={12} />
              {files}
            </span>
          )}
        </span>
        <span className="queued-actions">
          <RowStatus entry={entry} />
          {!entry.steering && (busy && !entry.after_compaction ? <Tooltip label={t("composer.queued_steer_hint")}>{steer_button}</Tooltip> : steer_button)}
          <IconButton label={t("composer.queued_discard")} size="sm" disabled={entry.steering} onClick={() => discard_queued(chat_id, entry.id)}>
            <TrashIcon size={14} />
          </IconButton>
          {!entry.steering && (
            <IconButton
              ref={set_more_anchor}
              size="sm"
              tooltip={false}
              label={t("composer.queued_more")}
              aria-haspopup="menu"
              aria-expanded={menu_open}
              active={menu_open}
              onClick={() => set_menu_open((was_open) => !was_open)}
            >
              <MoreHorizontalIcon size={16} />
            </IconButton>
          )}
        </span>
      </div>
      <Menu
        open={menu_open && !leaving}
        anchor={more_anchor}
        label={t("composer.queued_more")}
        placement="bottom-end"
        on_close={() => set_menu_open(false)}
        sections={[
          {
            id: "queued",
            items: [
              {
                id: "edit",
                label: t("composer.queued_edit"),
                icon: <PencilIcon size={15} />,
                on_select: () => {
                  edit_queued(chat_id, entry.id);
                  on_edited();
                },
              },
            ],
          },
        ]}
      />
    </li>
  );
};
