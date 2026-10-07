import { useEffect, useState } from "react";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { artifacts_store, load_artifacts } from "../../../state/artifacts.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { ArtifactLightbox } from "./ArtifactLightbox.tsx";
import "./ArtifactsDock.css";

const ArtifactsSkeleton = () => (
  <div className="artifact-grid" aria-busy="true">
    {[78, 56, 90, 64, 70, 48].map((width, index) => (
      <div key={index} className="artifact-card">
        <Skeleton width="100%" height="auto" radius={12} className="artifact-thumb-skeleton" />
        <div className="artifact-caption">
          <Skeleton width={`${width}%`} height={11} radius={4} />
        </div>
      </div>
    ))}
  </div>
);

export const ArtifactsDock = ({ visible, project_path }: DockViewProps) => {
  const t = use_t();
  const status = use_store(artifacts_store, (state) => state.status);
  const list = use_store(artifacts_store, (state) => state.list);
  const [renaming, set_renaming] = useState<string | null>(null);
  const [viewing, set_viewing] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      void load_artifacts(project_path);
    }
  }, [visible, project_path]);

  const body = () => {
    if (status === "loading" || status === "idle") {
      return <ArtifactsSkeleton />;
    }
    if (status === "failed") {
      return <DockEmpty text={t("docks.artifacts_failed")} />;
    }
    if (list.length === 0) {
      return <DockEmpty text={t("docks.artifacts_empty")} />;
    }
    return (
      <div className="artifact-grid">
        {list.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} renaming={renaming === artifact.id} on_rename={set_renaming} on_open={set_viewing} />
        ))}
      </div>
    );
  };

  return (
    <DockPanel
      title={<DockTitle label={t("docks.artifacts_title")} meta={status === "ready" && list.length > 0 ? String(list.length) : undefined} />}
      close_label={t("docks.artifacts_close")}
    >
      <div className="dock-scroll">{body()}</div>
      <ArtifactLightbox artifact={list.find((artifact) => artifact.id === viewing) ?? null} on_close={() => set_viewing(null)} />
    </DockPanel>
  );
};
