import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, SearchIcon } from "../../components/icons.tsx";
import { TextField } from "../../components/TextField.tsx";
import { trap_tab, use_focus_return, use_layer, use_presence } from "../../components/use-layer.ts";
import { use_t } from "../../i18n/index.ts";
import { close_settings, select_settings_section, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { settings_groups, settings_sections } from "./registry.ts";
import { filter_sections } from "./settings-search.ts";
import "./SettingsPage.css";

export const SettingsPage = () => {
  const t = use_t();
  const open = use_store(ui_store, (state) => state.settings_open);
  const selected = use_store(ui_store, (state) => state.settings_section);
  const presence = use_presence(open);
  const page = useRef<HTMLDivElement>(null);
  const [query, set_query] = useState("");
  use_layer(open, close_settings);
  use_focus_return(open);

  useEffect(() => {
    if (open) {
      page.current?.focus({ preventScroll: true });
      return;
    }
    set_query("");
  }, [open]);

  const visible = useMemo(() => filter_sections(settings_sections, query, t), [query, t]);
  const current = settings_sections.find((section) => section.id === selected) ?? settings_sections[0];
  const shown = visible.includes(current) || visible.length === 0 ? current : visible[0];

  if (!presence.mounted) {
    return null;
  }

  return (
    <div
      ref={page}
      className="settings-page"
      data-state={presence.state}
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      tabIndex={-1}
      onAnimationEnd={presence.on_animation_end}
      onKeyDown={(event) => trap_tab(event.currentTarget, event)}
    >
      <aside className="settings-rail">
        <button type="button" className="settings-back" onClick={close_settings}>
          <ArrowLeftIcon size={16} />
          <span>{t("settings.back")}</span>
        </button>
        <TextField
          className="settings-search"
          value={query}
          on_change={set_query}
          icon={<SearchIcon size={15} />}
          placeholder={t("settings.search")}
          aria-label={t("settings.search")}
        />
        <nav className="settings-nav" aria-label={t("settings.sections")}>
          {settings_groups.map((group) => {
            const items = visible.filter((section) => section.group === group.id);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={group.id} className="settings-nav-group">
                <div className="settings-nav-label section-label">{t(group.label)}</div>
                {items.map((section) => {
                  const SectionIcon = section.icon;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className="settings-nav-item"
                      aria-current={section === shown ? "page" : undefined}
                      onClick={() => select_settings_section(section.id)}
                    >
                      <SectionIcon size={16} />
                      <span>{t(section.label)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {visible.length === 0 && <div className="settings-no-results">{t("settings.no_results")}</div>}
        </nav>
      </aside>
      <div className="settings-content">
        <div key={shown.id} className="settings-column enter-fade-up">
          <h1 className="settings-heading">{t(shown.label)}</h1>
          <shown.Pane />
        </div>
      </div>
    </div>
  );
};
