import { useEffect, useRef, useState } from "react";
import type { ChatMeta } from "../../../shared/chat.ts";
import { IconButton } from "../../components/Button.tsx";
import { ConfirmDialog, Dialog } from "../../components/Dialog.tsx";
import { ArchiveRestoreIcon, MessageSquareIcon, TrashIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { relative_time } from "../../i18n/relative-time.ts";
import { delete_chat, set_chat_archived } from "../../state/chats.ts";
import { open_chat } from "../../state/ui.ts";
import { chat_label } from "./sidebar-model.ts";
import { WorktreeWarning } from "./WorktreeWarning.tsx";
import "./ArchivedDialog.css";

type ArchivedDialogProps = { open: boolean; chats: ChatMeta[]; active_chat_id: string | null; now: number; on_close: () => void };

type Deleting = { chat: ChatMeta; open: boolean };

type Removal = { chat_id: string; index: number };

export const ArchivedDialog = ({ open, chats, active_chat_id, now, on_close }: ArchivedDialogProps) => {
  const t = use_t();
  const [deleting, set_deleting] = useState<Deleting | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const removal = useRef<Removal | null>(null);

  useEffect(() => {
    const pending = removal.current;
    if (!pending || chats.some((chat) => chat.id === pending.chat_id)) {
      return;
    }
    removal.current = null;
    const next = list.current?.querySelectorAll<HTMLElement>(".archived-open")[Math.min(pending.index, chats.length - 1)];
    if (open && next && document.activeElement === document.body) {
      next.focus({ preventScroll: true });
    }
  }, [chats, open]);

  const choose = (chat: ChatMeta) => {
    open_chat(chat.id, chat.project_path);
    on_close();
  };

  const remove = (chat_id: string, action: string, run: (chat_id: string) => Promise<void>) => {
    removal.current = { chat_id, index: chats.findIndex((chat) => chat.id === chat_id) };
    run(chat_id).catch((error: unknown) => {
      if (removal.current?.chat_id === chat_id) {
        removal.current = null;
      }
      console.error(`[archive] ${action} failed for chat ${chat_id}`, error);
    });
  };

  return (
    <>
      <Dialog open={open} on_close={on_close} label={t("sidebar.archived_title")} className="archived-dialog" backdrop_className="archived-backdrop">
        <div className="archived-head">
          <h2 className="archived-title">{t("sidebar.archived_title")}</h2>
          <span className="archived-count">{chats.length}</span>
        </div>
        <div ref={list} className="archived-list" role="list">
          {chats.map((chat) => (
            <div key={chat.id} role="listitem" className="archived-row" data-active={chat.id === active_chat_id}>
              <button type="button" className="archived-open" aria-current={chat.id === active_chat_id ? "page" : undefined} onClick={() => choose(chat)}>
                <MessageSquareIcon size={16} className="archived-icon" />
                <span className="archived-text">
                  <span className="archived-name">{chat_label(t, chat.title)}</span>
                  <span className="archived-detail">{chat.project_path || t("search.no_project")}</span>
                </span>
                <span className="archived-time">{relative_time(t, chat.updated_at, now)}</span>
              </button>
              <div className="archived-actions">
                <IconButton size="sm" label={t("sidebar.restore")} onClick={() => remove(chat.id, "restore", (id) => set_chat_archived(id, false))}>
                  <ArchiveRestoreIcon size={15} />
                </IconButton>
                <IconButton size="sm" label={t("sidebar.delete")} className="archived-delete" onClick={() => set_deleting({ chat, open: true })}>
                  <TrashIcon size={15} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleting?.open ?? false}
        title={t("sidebar.delete_title")}
        detail={deleting ? chat_label(t, deleting.chat.title) : undefined}
        confirm_label={t("common.delete")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => {
          if (deleting) {
            remove(deleting.chat.id, "delete", delete_chat);
          }
        }}
        on_close={() => set_deleting((current) => (current ? { ...current, open: false } : null))}
      >
        {deleting && <WorktreeWarning target={{ kind: "chats", chat_ids: [deleting.chat.id] }} />}
      </ConfirmDialog>
    </>
  );
};
