import { memo, useState } from "react";
import type { ChatMeta } from "../../../shared/chat.ts";
import { IconButton } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/Dialog.tsx";
import { LoaderIcon, MoreHorizontalIcon, PencilLineIcon, PinIcon, PinOffIcon, TrashIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { relative_time } from "../../i18n/relative-time.ts";
import { delete_chat, rename_chat, set_chat_pinned } from "../../state/chats.ts";
import { open_chat } from "../../state/ui.ts";
import { InlineRename } from "./InlineRename.tsx";
import { chat_label } from "./sidebar-model.ts";

type ChatRowProps = { chat: ChatMeta; active: boolean; now: number };

const report = (action: string, chat_id: string) => (error: unknown) => console.error(`[sidebar] ${action} failed for chat ${chat_id}`, error);

export const ChatRow = memo(({ chat, active, now }: ChatRowProps) => {
  const t = use_t();
  const [menu_anchor, set_menu_anchor] = useState<HTMLButtonElement | null>(null);
  const [menu_open, set_menu_open] = useState(false);
  const [renaming, set_renaming] = useState(false);
  const [confirming, set_confirming] = useState(false);

  return (
    <div className="sidebar-row chat-row" data-active={active} data-menu-open={menu_open}>
      {renaming ? (
        <InlineRename
          initial={chat.title}
          label={t("sidebar.rename_label")}
          on_done={(title) => {
            set_renaming(false);
            if (title !== null) {
              rename_chat(chat.id, title).catch(report("rename", chat.id));
            }
          }}
        />
      ) : (
        <button type="button" className="sidebar-row-main" aria-current={active ? "page" : undefined} onClick={() => open_chat(chat.id, chat.project_path)}>
          <span className="sidebar-row-label">{chat_label(t, chat.title)}</span>
          {chat.streaming ? (
            <span className="chat-row-status" role="status" aria-label={t("sidebar.working")}>
              <LoaderIcon size={12} className="spin" />
            </span>
          ) : (
            <span className="chat-row-time">{relative_time(t, chat.updated_at, now)}</span>
          )}
        </button>
      )}
      {!renaming && (
        <IconButton
          ref={set_menu_anchor}
          size="sm"
          tooltip={false}
          className="sidebar-row-more"
          label={t("sidebar.chat_options")}
          aria-haspopup="menu"
          aria-expanded={menu_open}
          active={menu_open}
          onClick={() => set_menu_open((was_open) => !was_open)}
        >
          <MoreHorizontalIcon size={15} />
        </IconButton>
      )}
      <Menu
        open={menu_open}
        anchor={menu_anchor}
        label={t("sidebar.chat_options")}
        on_close={() => set_menu_open(false)}
        sections={[
          {
            id: "chat",
            items: [
              { id: "rename", label: t("sidebar.rename"), icon: <PencilLineIcon size={15} />, on_select: () => set_renaming(true) },
              {
                id: "pin",
                label: chat.pinned ? t("sidebar.unpin") : t("sidebar.pin"),
                icon: chat.pinned ? <PinOffIcon size={15} /> : <PinIcon size={15} />,
                on_select: () => set_chat_pinned(chat.id, !chat.pinned).catch(report("pin", chat.id)),
              },
              { id: "delete", label: t("sidebar.delete"), icon: <TrashIcon size={15} />, danger: true, on_select: () => set_confirming(true) },
            ],
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title={t("sidebar.delete_title")}
        detail={chat_label(t, chat.title)}
        confirm_label={t("common.delete")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => delete_chat(chat.id).catch(report("delete", chat.id))}
        on_close={() => set_confirming(false)}
      />
    </div>
  );
});
