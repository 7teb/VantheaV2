import { FileDiffIcon, FolderIcon, HistoryIcon } from "../../../../components/icons.tsx";
import { Segmented } from "../../../../components/Segmented.tsx";
import { use_t } from "../../../../i18n/index.ts";
import { set_surface, type GitSurface } from "../../../../state/git.ts";
import "./SurfaceSwitch.css";

type SurfaceSwitchProps = { surface: GitSurface; changes: number; history: boolean; meta: string | undefined; narrow: boolean };

export const SurfaceSwitch = ({ surface, changes, history, meta, narrow }: SurfaceSwitchProps) => {
  const t = use_t();
  return (
    <div className="git-head">
      <Segmented
        className="git-switch"
        fit
        tooltips={narrow}
        label={t("git.surface")}
        value={surface}
        on_change={set_surface}
        options={[
          { id: "files", label: t("git.files"), icon: <FolderIcon size={16} /> },
          { id: "changes", label: t("git.changes"), icon: <FileDiffIcon size={16} />, count: changes > 0 ? changes : undefined, disabled: changes === 0 },
          { id: "history", label: t("git.history"), icon: <HistoryIcon size={16} />, disabled: !history },
        ]}
      />
      {meta && <span className="dock-title-meta">{meta}</span>}
    </div>
  );
};
