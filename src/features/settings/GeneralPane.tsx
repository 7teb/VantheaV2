import { useState } from "react";
import type { Language } from "../../../shared/settings.ts";
import { Segmented, type SegmentedOption } from "../../components/Segmented.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import { settings_store, update_settings } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { BalanceLine } from "./BalanceLine.tsx";
import { SecretRow } from "./panes/SecretRow.tsx";
import { SettingsGroup, SettingsRow } from "./SettingsLayout.tsx";
import "./GeneralPane.css";

const language_options: SegmentedOption<Language>[] = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

export const GeneralPane = () => {
  const t = use_t();
  const language = use_store(settings_store, (view) => view?.language ?? null);
  const has_key = use_store(settings_store, (view) => view?.secrets.openrouter ?? false);
  const [revision, set_revision] = useState(0);

  if (language === null) {
    return (
      <SettingsGroup>
        {[0, 1, 2].map((row) => (
          <div key={row} className="settings-row">
            <Skeleton width={140} height={13} radius={5} />
            <Skeleton width={180} height={30} radius={9} />
          </div>
        ))}
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup>
      <SettingsRow label={t("settings.language")} hint={t("settings.language_sub")}>
        <Segmented
          className="language-switch"
          options={language_options}
          value={language}
          label={t("settings.language")}
          on_change={(next) => update_settings({ language: next })}
        />
      </SettingsRow>
      <SecretRow
        name="openrouter"
        label={t("settings.api_key")}
        stored={has_key}
        placeholder={t("settings.key_placeholder")}
        on_saved={() => set_revision((value) => value + 1)}
      />
      <SettingsRow label={t("settings.balance")}>
        <BalanceLine has_key={has_key} revision={revision} />
      </SettingsRow>
    </SettingsGroup>
  );
};
