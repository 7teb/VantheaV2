import type { GitFileDiff } from "../../../../../shared/git-view.ts";
import type { DiffEntry, DiffScope } from "../../../../../shared/turn-diff.ts";
import { use_t } from "../../../../i18n/index.ts";
import type { GitLoad } from "../../../../state/git-diff.ts";
import { use_turn_file } from "../../../../state/turn-diff.ts";
import { DockEmpty } from "../../DockPanel.tsx";
import { diff_meta, DiffBody, ViewerNote } from "../git/ViewerDiff.tsx";
import { PathBar, ViewerSkeleton } from "../ViewerParts.tsx";
import { file_note_keys } from "./turn-diff-notes.ts";

const FileBody = ({ load }: { load: GitLoad<GitFileDiff> | null }) => {
  const t = use_t();
  const diff = load?.value;
  if (diff) {
    return diff.kind === "text" ? <DiffBody diff={diff} /> : <ViewerNote text={t(file_note_keys[diff.kind])} />;
  }
  return load?.status === "failed" ? <DockEmpty text={t("git.diff_failed")} /> : <ViewerSkeleton />;
};

type TurnDiffViewerProps = { chat_id: string; scope: DiffScope; entry: DiffEntry; live: boolean };

export const TurnDiffViewer = ({ chat_id, scope, entry, live }: TurnDiffViewerProps) => {
  const load = use_turn_file(chat_id, scope, entry.path, live);
  return (
    <section className="files-viewer turn-diff-viewer">
      <PathBar path={entry.path} meta={diff_meta(load)} on_disk={entry.status !== "deleted"} />
      <FileBody load={load} />
    </section>
  );
};
