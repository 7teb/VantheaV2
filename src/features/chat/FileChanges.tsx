import { memo, useMemo, useState } from "react";
import type { AssistantMessage } from "../../../shared/chat.ts";
import type { UndoResult } from "../../../shared/ipc/chats.ts";
import { Button } from "../../components/Button.tsx";
import { CheckIcon, FileDiffIcon, UndoIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { undo_turn } from "../../state/chat-actions.ts";
import { file_changes } from "./assistant-blocks.ts";

const collapsed_count = 3;

type FileChangesProps = { chat_id: string; message: AssistantMessage; busy: boolean; reverted: UndoResult | null };

export const FileChanges = memo(({ chat_id, message, busy, reverted }: FileChangesProps) => {
  const t = use_t();
  const changes = useMemo(() => file_changes(message), [message]);
  const [expanded, set_expanded] = useState(false);
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");
  if (changes.length === 0) {
    return null;
  }

  const undo = async () => {
    set_pending(true);
    const result = await undo_turn(chat_id, message.id);
    set_error(result.ok ? "" : result.error);
    set_pending(false);
  };

  const added = changes.reduce((sum, change) => sum + change.added, 0);
  const removed = changes.reduce((sum, change) => sum + change.removed, 0);
  const shown = expanded ? changes : changes.slice(0, collapsed_count);
  const hidden = changes.length - collapsed_count;

  return (
    <div className="file-changes enter-fade-up" data-reverted={reverted !== null}>
      <div className="file-changes-head">
        <FileDiffIcon size={15} />
        <span className="file-changes-title">{changes.length === 1 ? t("chat.files_edited_one") : t("chat.files_edited_other", { n: changes.length })}</span>
        <span className="tool-stat-add">+{added}</span>
        <span className="tool-stat-remove">-{removed}</span>
        <span className="file-changes-spacer" />
        {reverted ? (
          <span className="file-changes-reverted">
            <CheckIcon size={13} />
            {t("chat.changes_reverted")}
          </span>
        ) : (
          <Button variant="ghost" icon={<UndoIcon size={14} />} disabled={busy || pending} onClick={() => void undo()}>
            {t("chat.changes_undo")}
          </Button>
        )}
      </div>
      <ul className="file-changes-list">
        {shown.map((change) => (
          <li key={change.path} className="file-changes-row" title={change.path}>
            <span className="file-changes-path">{change.path}</span>
            <span className="tool-stat-add">+{change.added}</span>
            <span className="tool-stat-remove">-{change.removed}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="output-block-more" onClick={() => set_expanded(!expanded)}>
          {expanded ? t("chat.changes_show_less") : t("chat.changes_show_more", { n: hidden })}
        </button>
      )}
      {reverted && reverted.failed.length > 0 && <div className="inline-error">{t("chat.changes_undo_failed", { n: reverted.failed.length })}</div>}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
});
