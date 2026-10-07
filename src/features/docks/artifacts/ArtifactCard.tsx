import type { Artifact } from "../../../../shared/ipc/media.ts";
import { IconButton } from "../../../components/Button.tsx";
import { DownloadIcon, PencilIcon, PinIcon, PinOffIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { artifact_url, export_artifact, rename_artifact, set_artifact_pinned } from "../../../state/artifacts.ts";
import { InlineRename } from "../../sidebar/InlineRename.tsx";

type ArtifactCardProps = {
  artifact: Artifact;
  renaming: boolean;
  on_rename: (artifact_id: string | null) => void;
  on_open: (artifact_id: string) => void;
};

export const artifact_label = (artifact: Artifact, fallback: string) => artifact.title || artifact.prompt || fallback;

export const ArtifactCard = ({ artifact, renaming, on_rename, on_open }: ArtifactCardProps) => {
  const t = use_t();
  const label = artifact_label(artifact, t("docks.artifacts_untitled"));

  return (
    <figure className="artifact-card" data-pinned={artifact.pinned}>
      <button type="button" className="artifact-thumb" aria-label={t("docks.artifacts_view", { x: label })} onClick={() => on_open(artifact.id)}>
        <img src={artifact_url(artifact.id)} alt="" loading="lazy" decoding="async" draggable={false} />
      </button>
      <figcaption className="artifact-caption">
        {renaming ? (
          <InlineRename
            initial={artifact.title}
            label={t("docks.artifacts_rename")}
            on_done={(title) => {
              on_rename(null);
              if (title !== null) {
                void rename_artifact(artifact.id, title);
              }
            }}
          />
        ) : (
          <span className="artifact-title" title={label} onDoubleClick={() => on_rename(artifact.id)}>
            {label}
          </span>
        )}
        <span className="artifact-actions">
          <IconButton
            size="sm"
            label={artifact.pinned ? t("docks.artifacts_unpin") : t("docks.artifacts_pin")}
            active={artifact.pinned}
            onClick={() => void set_artifact_pinned(artifact.id, !artifact.pinned)}
          >
            {artifact.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
          </IconButton>
          <IconButton size="sm" label={t("docks.artifacts_rename")} onClick={() => on_rename(artifact.id)}>
            <PencilIcon size={14} />
          </IconButton>
          <IconButton size="sm" label={t("docks.artifacts_export")} onClick={() => void export_artifact(artifact.id)}>
            <DownloadIcon size={14} />
          </IconButton>
        </span>
      </figcaption>
    </figure>
  );
};
