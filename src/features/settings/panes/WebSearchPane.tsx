import { useState } from "react";
import type { Settings } from "../../../../shared/settings.ts";
import { Segmented } from "../../../components/Segmented.tsx";
import { Slider } from "../../../components/Slider.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t } from "../../../i18n/index.ts";
import { settings_store, update_settings } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { PaneSkeleton } from "./PaneSkeleton.tsx";
import { SecretRow } from "./SecretRow.tsx";
import "./panes.css";

type WebSearch = Settings["web_search"];

const ResultsSlider = ({ saved }: { saved: number }) => {
  const t = use_t();
  const [value, set_value] = useState(saved);
  const [base, set_base] = useState(saved);

  if (saved !== base) {
    set_base(saved);
    set_value(saved);
  }

  const commit = () => {
    if (value !== saved) {
      void update_settings({ web_search: { max_results: value } });
    }
  };

  return (
    <div className="slider-control" onPointerUp={commit} onKeyUp={commit} onBlur={commit}>
      <Slider value={value} min={1} max={20} on_change={set_value} label={t("web.results")} value_text={String(value)} className="results-slider" />
      <span className="slider-value">{value}</span>
    </div>
  );
};

export const WebSearchPane = () => {
  const t = use_t();
  const web = use_store(settings_store, (view) => view?.web_search ?? null);
  const has_key = use_store(settings_store, (view) => view?.secrets.tavily ?? false);

  if (web === null) {
    return <PaneSkeleton rows={[120, 110, 130, 90, 70]} />;
  }

  const patch = (next: Partial<WebSearch>) => void update_settings({ web_search: next });

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("web.enable")} hint={t("web.enable_sub")}>
          <Toggle checked={web.enabled} label={t("web.enable")} on_change={(enabled) => patch({ enabled })} />
        </SettingsRow>
        <SecretRow name="tavily" label={t("web.key")} stored={has_key} placeholder={t("web.key_placeholder")} />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label={t("web.results")}>
          <ResultsSlider saved={web.max_results} />
        </SettingsRow>
        <SettingsRow label={t("web.depth")} hint={t("web.depth_sub")}>
          <Segmented
            className="pane-segmented"
            options={[
              { id: "basic", label: t("web.depth_basic") },
              { id: "advanced", label: t("web.depth_advanced") },
            ]}
            value={web.depth}
            label={t("web.depth")}
            on_change={(depth) => patch({ depth })}
          />
        </SettingsRow>
        <SettingsRow label={t("web.topic")}>
          <Segmented
            className="pane-segmented"
            options={[
              { id: "general", label: t("web.topic_general") },
              { id: "news", label: t("web.topic_news") },
            ]}
            value={web.topic}
            label={t("web.topic")}
            on_change={(topic) => patch({ topic })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
};
