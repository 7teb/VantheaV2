import type { Settings } from "../../../../shared/settings.ts";
import { Segmented } from "../../../components/Segmented.tsx";
import { Select } from "../../../components/Select.tsx";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t } from "../../../i18n/index.ts";
import { settings_store, update_settings } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { PaneSkeleton } from "./PaneSkeleton.tsx";
import { use_catalog } from "./use-catalog.ts";
import "./panes.css";

type ImageGen = Settings["image_gen"];

export const ImagePane = () => {
  const t = use_t();
  const image = use_store(settings_store, (view) => view?.image_gen ?? null);
  const catalog = use_catalog();

  if (image === null) {
    return <PaneSkeleton rows={[150, 100, 70]} />;
  }

  const patch = (next: Partial<ImageGen>) => void update_settings({ image_gen: next });
  const models = catalog.status === "ready" ? catalog.catalog.image_models : [];
  const model = models.find((entry) => entry.id === image.model) ?? null;

  const model_control = () => {
    if (catalog.status === "loading") {
      return <Skeleton width={180} height={32} radius={9} />;
    }
    if (catalog.status === "failed") {
      return <span className="pane-value is-muted">{t("image.catalog_failed")}</span>;
    }
    return (
      <Select
        options={models.map((entry) => ({ id: entry.id, label: entry.label }))}
        value={image.model}
        label={t("image.model")}
        on_change={(id) => patch({ model: id })}
      />
    );
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("image.enable")} hint={t("image.enable_sub")}>
          <Toggle checked={image.enabled} label={t("image.enable")} on_change={(enabled) => patch({ enabled })} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label={t("image.model")} hint={t("image.model_sub")}>
          {model_control()}
        </SettingsRow>
        {model?.quality && (
          <SettingsRow label={t("image.quality")}>
            <Segmented
              className="pane-segmented is-wide"
              options={[
                { id: "auto", label: t("image.q_auto") },
                { id: "low", label: t("image.q_low") },
                { id: "medium", label: t("image.q_medium") },
                { id: "high", label: t("image.q_high") },
              ]}
              value={image.quality}
              label={t("image.quality")}
              on_change={(quality) => patch({ quality })}
            />
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  );
};
