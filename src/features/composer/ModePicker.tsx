import { useState } from "react";
import type { PermissionMode } from "../../../shared/chat.ts";
import { ChevronDownIcon, HandIcon, ShieldAlertIcon, ShieldCheckIcon, type IconComponent } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { settings_store, update_settings } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";

const modes: { id: PermissionMode; icon: IconComponent; label: MessageKey; hint: MessageKey }[] = [
  { id: "ask", icon: HandIcon, label: "composer.permission_ask", hint: "composer.permission_ask_desc" },
  { id: "auto", icon: ShieldCheckIcon, label: "composer.permission_auto", hint: "composer.permission_auto_desc" },
  { id: "full", icon: ShieldAlertIcon, label: "composer.permission_full", hint: "composer.permission_full_desc" },
];

export const ModePicker = () => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const mode = use_store(settings_store, (state) => state?.mode ?? null);

  if (mode === null) {
    return <Skeleton width={72} height={32} radius={9} />;
  }

  const current = modes.find((entry) => entry.id === mode) ?? modes[0];
  const Icon = current.icon;

  return (
    <>
      <button
        ref={set_anchor}
        type="button"
        className="composer-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.permission_title")}
        title={t(current.hint)}
        data-open={open}
        data-mode={mode}
        onClick={() => set_open(!open)}
      >
        <Icon size={15} />
        <span className="composer-chip-label">{t(current.label)}</span>
        <ChevronDownIcon size={14} className="composer-chip-chevron" />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        label={t("composer.permission_title")}
        sections={[
          {
            id: "modes",
            label: t("composer.permission_title"),
            items: modes.map((entry) => {
              const EntryIcon = entry.icon;
              return {
                id: entry.id,
                label: t(entry.label),
                icon: <EntryIcon size={15} />,
                checked: entry.id === mode,
                on_select: () => void update_settings({ mode: entry.id }),
              };
            }),
          },
        ]}
        on_close={() => set_open(false)}
        placement="top-start"
        min_width={220}
        className="composer-menu"
      />
    </>
  );
};
