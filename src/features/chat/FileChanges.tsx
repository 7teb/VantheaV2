import { memo, useMemo, useState } from "react";
import type { Step } from "../../../shared/chat.ts";
import type { DiffScope } from "../../../shared/turn-diff.ts";
import { Button } from "../../components/Button.tsx";
import { FileDiffIcon, GitCompareIcon, UndoIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { undo_turn } from "../../state/chat-actions.ts";
import { open_turn_diff, show_changed_file } from "../../state/turn-diff-ui.ts";
import { use_turn_summary } from "../../state/turn-diff.ts";
import { card_changes, type CardRow } from "./card-changes.ts";

const collapsed_count = 3;

const RowStats = ({ row }: { row: CardRow }) => {
  const t = use_t();
  if (row.submodule) {
    return null;
  }
  if (row.binary) {
    return <span className="file-changes-meta">{t("git.binary")}</span>;
  }
  return (
    <>
      <span className="tool-stat-add">+{row.added}</span>
      <span className="tool-stat-remove">-{row.removed}</span>
    </>
  );
};

type FileChangesProps = { chat_id: string; steps: Step[]; from_id: string; to_id: string; undo_id: string | null; busy: boolean };

export const FileChanges = memo(({ chat_id, steps, from_id, to_id, undo_id, busy }: FileChangesProps) => {
  const t = use_t();
  const scope = useMemo((): DiffScope => ({ kind: "turn", from_id, to_id }), [from_id, to_id]);
  const summary = use_turn_summary(chat_id, scope, true)?.value ?? null;
  const card = useMemo(() => card_changes(summary, steps), [summary, steps]);
  const [expanded, set_expanded] = useState(false);
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");
  const rows = card.rows;
  if (rows.length === 0) {
    return null;
  }

  const undo = async (message_id: string) => {
    set_pending(true);
    const result = await undo_turn(chat_id, message_id);
    set_error(result.ok ? "" : result.error);
    set_pending(false);
  };

  const open_row = (row: CardRow) => {
    if (row.deleted || row.submodule) {
      open_turn_diff({ from_id, to_id }, row.deleted ? row.path : null);
      return;
    }
    show_changed_file(row.path);
  };

  const snapshot = card.source === "snapshot";
  const one_key = snapshot ? "chat.files_changed_one" : "chat.files_edited_one";
  const other_key = snapshot ? "chat.files_changed_other" : "chat.files_edited_other";
  const title = rows.length === 1 ? t(one_key) : t(other_key, { n: rows.length });
  const added = rows.reduce((sum, row) => sum + row.added, 0);
  const removed = rows.reduce((sum, row) => sum + row.removed, 0);
  const shown = expanded ? rows : rows.slice(0, collapsed_count);
  const hidden = rows.length - collapsed_count;

  return (
    <div className="file-changes enter-fade-up">
      <div className="file-changes-head">
        <FileDiffIcon size={15} />
        <span className="file-changes-title">{title}</span>
        <span className="tool-stat-add">+{added}</span>
        <span className="tool-stat-remove">-{removed}</span>
        <span className="file-changes-actions">
          <Button variant="ghost" icon={<GitCompareIcon size={14} />} onClick={() => open_turn_diff({ from_id, to_id })}>
            {t("chat.changes_show_diff")}
          </Button>
          {undo_id !== null && (
            <Button variant="ghost" icon={<UndoIcon size={14} />} disabled={busy || pending} onClick={() => void undo(undo_id)}>
              {t("chat.changes_undo")}
            </Button>
          )}
        </span>
      </div>
      <ul className="file-changes-list">
        {shown.map((row) => (
          <li key={row.path}>
            <button type="button" className="file-changes-row" data-deleted={row.deleted} title={row.path} onClick={() => open_row(row)}>
              <span className="file-changes-path">{row.path}</span>
              <RowStats row={row} />
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
