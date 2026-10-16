import type { GitConflict, GitEntry, GitFileStatus, GitSubmoduleState } from "../../../../../shared/git-view.ts";
import type { GitDecoration } from "../../../../../shared/git/decorations.ts";
import { use_t, type MessageKey, type Translate } from "../../../../i18n/index.ts";
import "./GitBadge.css";

type PlainStatus = Exclude<GitFileStatus, "conflicted" | "renamed" | "copied" | "ignored">;

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

const plain_titles: Record<PlainStatus, MessageKey> = {
  modified: "git.badge_modified",
  added: "git.badge_added",
  deleted: "git.badge_deleted",
  type_changed: "git.badge_type_changed",
  untracked: "git.badge_untracked",
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

const status_title = (t: Translate, status: Exclude<GitFileStatus, "ignored">, entry: GitEntry | null): string => {
  if (status === "conflicted") {
    return conflict_title(t, entry?.conflict ?? null);
  }
  const title =
    status === "renamed" || status === "copied"
      ? t(status === "renamed" ? "git.badge_renamed" : "git.badge_copied", { path: entry?.orig_path ?? "" })
      : t(plain_titles[status]);
  if (!entry?.staged) {
    return title;
  }
  return t(entry.unstaged ? "git.badge_partly_staged" : "git.badge_staged", { status: title });
};

const submodule_title = (t: Translate, status: Exclude<GitFileStatus, "ignored">, entry: GitEntry, state: GitSubmoduleState): string => {
  const parts: string[] = [];
  if (state.commit) parts.push(t("git.submodule_commit"));
  if (state.tracked) parts.push(t("git.submodule_tracked"));
  if (state.untracked) parts.push(t("git.submodule_untracked"));
  return t("git.badge_submodule", { changes: parts.length > 0 ? parts.join(", ") : status_title(t, status, entry) });
};

type GitBadgeProps = { decoration: GitDecoration | null; dir: boolean };

export const GitBadge = ({ decoration, dir }: GitBadgeProps) => {
  const t = use_t();
  if (!decoration || decoration.status === "ignored" || decoration.entry?.nested_repo) {
    return null;
  }
  const { status, entry } = decoration;
  if (entry?.submodule && status !== "conflicted") {
    return (
      <span className="git-badge" data-git="submodule" title={submodule_title(t, status, entry, entry.submodule)}>
        S
      </span>
    );
  }
  if (dir) {
    return (
      <span className="git-badge" data-git={status} title={decoration.rollup ? t("git.badge_contains") : status_title(t, status, entry)}>
        <span className="git-badge-dot" />
      </span>
    );
  }
  return (
    <span className="git-badge" data-git={status} title={status_title(t, status, entry)}>
      {letters[status]}
    </span>
  );
};
