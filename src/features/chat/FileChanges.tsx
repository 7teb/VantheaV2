import { memo, useMemo, useState } from "react";
import type { Step } from "../../../shared/chat.ts";
import { file_changes } from "../../../shared/file-changes.ts";
import { Button } from "../../components/Button.tsx";
import { FileDiffIcon, UndoIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { undo_turn } from "../../state/chat-actions.ts";
import { show_file } from "../../state/files.ts";

const collapsed_count = 3;

type FileChangesProps = { chat_id: string; steps: Step[]; undo_id: string | null; busy: boolean };

export const FileChanges = memo(({ chat_id, steps, undo_id, busy }: FileChangesProps) => {
  const t = use_t();
  const changes = useMemo(() => file_changes(steps), [steps]);
  const [expanded, set_expanded] = useState(false);
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");
  if (changes.length === 0) {
    return null;
  }

  const undo = async (message_id: string) => {
    set_pending(true);
    const result = await undo_turn(chat_id, message_id);
    set_error(result.ok ? "" : result.error);
    set_pending(false);
  };

  const added = changes.reduce((sum, change) => sum + change.added, 0);
  const removed = changes.reduce((sum, change) => sum + change.removed, 0);
  const shown = expanded ? changes : changes.slice(0, collapsed_count);
  const hidden = changes.length - collapsed_count;

  return (
    <div className="file-changes enter-fade-up">
      <div className="file-changes-head">
        <FileDiffIcon size={15} />
        <span className="file-changes-title">{changes.length === 1 ? t("chat.files_edited_one") : t("chat.files_edited_other", { n: changes.length })}</span>
        <span className="tool-stat-add">+{added}</span>
        <span className="tool-stat-remove">-{removed}</span>
        <span className="file-changes-spacer" />
        {undo_id !== null && (
          <Button variant="ghost" icon={<UndoIcon size={14} />} disabled={busy || pending} onClick={() => void undo(undo_id)}>
            {t("chat.changes_undo")}
          </Button>
        )}
      </div>
      <ul className="file-changes-list">
        {shown.map((change) => (
          <li key={change.path}>
            <button type="button" className="file-changes-row" title={change.path} onClick={() => show_file(change.path)}>
              <span className="file-changes-path">{change.path}</span>
              <span className="tool-stat-add">+{change.added}</span>
              <span className="tool-stat-remove">-{change.removed}</span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="output-block-more" onClick={() => set_expanded(!expanded)}>
          {expanded ? t("chat.changes_show_less") : t("chat.changes_show_more", { n: hidden })}
        </button>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
});
