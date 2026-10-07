import { useState } from "react";
import type { Artifact } from "../../../../shared/ipc/media.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { CloseIcon, DownloadIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { artifact_url, export_artifact } from "../../../state/artifacts.ts";
import { artifact_label } from "./ArtifactCard.tsx";

type ArtifactLightboxProps = { artifact: Artifact | null; on_close: () => void };

export const ArtifactLightbox = ({ artifact, on_close }: ArtifactLightboxProps) => {
  const t = use_t();
  const [last, set_last] = useState(artifact);
  if (artifact && artifact !== last) {
    set_last(artifact);
  }
  const shown = artifact ?? last;
  const label = shown ? artifact_label(shown, t("docks.artifacts_untitled")) : "";

  return (
    <Dialog open={artifact !== null} on_close={on_close} label={label} className="artifact-lightbox" initial_focus="panel">
      {shown && (
        <>
          <div className="artifact-lightbox-stage">
            <img src={artifact_url(shown.id)} alt={label} draggable={false} />
          </div>
          <div className="artifact-lightbox-bar">
            <div className="artifact-lightbox-text">
              <div className="artifact-lightbox-title">{label}</div>
              {shown.prompt && shown.prompt !== label && <div className="artifact-lightbox-prompt">{shown.prompt}</div>}
            </div>
            <Button icon={<DownloadIcon size={15} />} onClick={() => void export_artifact(shown.id)}>
              {t("docks.artifacts_export")}
            </Button>
            <IconButton label={t("common.close")} onClick={on_close}>
              <CloseIcon size={16} />
            </IconButton>
          </div>
        </>
      )}
    </Dialog>
  );
};
