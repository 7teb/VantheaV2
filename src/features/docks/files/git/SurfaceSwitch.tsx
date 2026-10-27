import { FileDiffIcon, FolderIcon, GitCompareIcon, HistoryIcon } from "../../../../components/icons.tsx";
import { Segmented, type SegmentedOption } from "../../../../components/Segmented.tsx";
import { use_t } from "../../../../i18n/index.ts";
import type { GitSurface } from "../../../../state/git.ts";
import { pick_surface } from "../../../../state/turn-diff-ui.ts";
import "./SurfaceSwitch.css";

type SurfaceSwitchProps = { surface: GitSurface; git: boolean; diff: boolean; changes: number; history: boolean; meta: string | undefined; narrow: boolean };

export const SurfaceSwitch = ({ surface, git, diff, changes, history, meta, narrow }: SurfaceSwitchProps) => {
  const t = use_t();
  const options: SegmentedOption<GitSurface>[] = [{ id: "files", label: t("git.files"), icon: <FolderIcon size={16} /> }];
  if (git) {
    options.push(
      { id: "changes", label: t("git.changes"), icon: <FileDiffIcon size={16} />, count: changes > 0 ? changes : undefined, disabled: changes === 0 },
      { id: "history", label: t("git.history"), icon: <HistoryIcon size={16} />, disabled: !history },
    );
  }
  options.push({ id: "diff", label: t("turn_diff.surface"), tip: t("turn_diff.surface_tip"), icon: <GitCompareIcon size={16} />, disabled: !diff });
  return (
    <div className="git-head">
      <Segmented className="git-switch" fit tooltips={narrow} label={t("git.surface")} value={surface} on_change={pick_surface} options={options} />
      {meta && <span className="dock-title-meta">{meta}</span>}
    </div>
  );
};
