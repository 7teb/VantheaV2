import type { GitConflict, GitFileStatus } from "../../../../../shared/git-view.ts";
import type { GitDecoration } from "../../../../../shared/git/decorations.ts";
import type { MessageKey, Translate } from "../../../../i18n/index.ts";
import "./GitBadge.css";

const letters: Record<Exclude<GitFileStatus, "ignored">, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  type_changed: "T",
  untracked: "U",
  conflicted: "!",
};

const conflict_titles: Record<GitConflict, MessageKey> = {
  UU: "git.conflict_uu",
  AA: "git.conflict_aa",
  DD: "git.conflict_dd",
  AU: "git.conflict_au",
  UA: "git.conflict_ua",
  DU: "git.conflict_du",
  UD: "git.conflict_ud",
};

export const conflict_title = (t: Translate, conflict: GitConflict | null): string => t(conflict ? conflict_titles[conflict] : "git.conflict");

type GitBadgeProps = { decoration: GitDecoration | null; dir: boolean };

export const GitBadge = ({ decoration, dir }: GitBadgeProps) => {
  if (!decoration || decoration.status === "ignored" || decoration.entry?.nested_repo) {
    return null;
  }
  const { status, entry } = decoration;
  if (entry?.submodule && status !== "conflicted") {
    return (
      <span className="git-badge" data-git="submodule">
        S
      </span>
    );
  }
  if (dir) {
    return (
      <span className="git-badge" data-git={status}>
        <span className="git-badge-dot" />
      </span>
    );
  }
  return (
    <span className="git-badge" data-git={status}>
      {letters[status]}
    </span>
  );
};
