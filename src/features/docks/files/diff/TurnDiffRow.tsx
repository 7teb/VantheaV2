import type { DiffEntry } from "../../../../../shared/turn-diff.ts";
import { use_t } from "../../../../i18n/index.ts";
import { base_name } from "../../../../state/files-tree.ts";
import { ChangeCounts } from "../git/ChangesList.tsx";
import { badge_title, entry_place, entry_title, openable, status_letters, submodule_text } from "./diff-rows.ts";
import "../git/GitBadge.css";

const RowMeta = ({ entry }: { entry: DiffEntry }) => {
  const t = use_t();
  if (entry.status === "submodule") {
    return (
      <span className="git-counts">
        <span className="git-binary">{submodule_text(entry, t("turn_diff.no_commit"))}</span>
      </span>
    );
  }
  if (entry.binary || entry.added === null || entry.removed === null) {
    return (
      <span className="git-counts">
        <span className="git-binary">{t("git.binary")}</span>
      </span>
    );
  }
  return <ChangeCounts added={entry.added} removed={entry.removed} />;
};

type TurnDiffRowProps = { entry: DiffEntry; active: boolean; on_open: (entry: DiffEntry) => void };

export const TurnDiffRow = ({ entry, active, on_open }: TurnDiffRowProps) => {
  const t = use_t();
  const content = (
    <>
      <span className="git-badge" data-git={entry.status} title={badge_title(t, entry)}>
        {status_letters[entry.status]}
      </span>
      <span className="git-change-name">{base_name(entry.path)}</span>
      <span className="git-change-dir">{entry_place(entry)}</span>
      <RowMeta entry={entry} />
    </>
  );
  if (!openable(entry)) {
    return (
      <div className="git-change" data-git={entry.status} title={entry_title(entry)}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className="git-change" data-git={entry.status} data-active={active} title={entry_title(entry)} onClick={() => on_open(entry)}>
      {content}
    </button>
  );
};
