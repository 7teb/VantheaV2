import { useEffect, useRef } from "react";
import { PlusIcon } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t, type MessageKey } from "../../i18n/index.ts";
import { apply_accent } from "../../state/accent.ts";
import { settings_store, update_settings } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { SettingsRow } from "./SettingsLayout.tsx";
import "./AccentRow.css";

const presets: { color: string; label: MessageKey }[] = [
  { color: "", label: "settings.accent_violet" },
  { color: "#4f8ff7", label: "settings.accent_blue" },
  { color: "#22b8cf", label: "settings.accent_cyan" },
  { color: "#3fb950", label: "settings.accent_green" },
  { color: "#e3a008", label: "settings.accent_amber" },
  { color: "#f0883e", label: "settings.accent_orange" },
  { color: "#f85149", label: "settings.accent_red" },
  { color: "#e85aad", label: "settings.accent_pink" },
];

const default_accent = (): string => getComputedStyle(document.documentElement).getPropertyValue("--accent-default").trim();

const choose = (color: string) => {
  void update_settings({ accent_color: color }).catch((error: unknown) => console.error(`[settings] saving accent color ${color || "default"} failed`, error));
};

const CustomSwatch = ({ color, custom }: { color: string; custom: boolean }) => {
  const t = use_t();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = input.current;
    if (!node) {
      return;
    }
    node.value = color || default_accent();
    const commit = () => choose(node.value);
    node.addEventListener("change", commit);
    return () => node.removeEventListener("change", commit);
  }, [color]);

  return (
    <Tooltip label={t("settings.accent_custom")}>
      <label className="accent-swatch accent-custom" data-custom={custom} style={custom ? { background: color } : undefined}>
        {!custom && <PlusIcon />}
        <input ref={input} type="color" aria-label={t("settings.accent_custom")} onChange={(event) => apply_accent(event.target.value)} />
      </label>
    </Tooltip>
  );
};

export const AccentRow = () => {
  const t = use_t();
  const color = use_store(settings_store, (view) => view?.accent_color ?? "");
  const custom = !presets.some((preset) => preset.color === color);

  return (
    <SettingsRow label={t("settings.accent")} hint={t("settings.accent_sub")}>
      <div className="accent-swatches" role="radiogroup" aria-label={t("settings.accent")}>
        {presets.map((preset) => (
          <Tooltip key={preset.label} label={t(preset.label)}>
            <button
              type="button"
              role="radio"
              aria-checked={preset.color === color}
              aria-label={t(preset.label)}
              className="accent-swatch"
              data-default={preset.color === "" || undefined}
              style={preset.color ? { background: preset.color } : undefined}
              onClick={() => choose(preset.color)}
            />
          </Tooltip>
        ))}
        <CustomSwatch color={color} custom={custom} />
      </div>
    </SettingsRow>
  );
};
