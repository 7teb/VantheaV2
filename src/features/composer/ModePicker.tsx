import { useState } from "react";
import { full_window_minutes } from "../../../shared/approval.ts";
import type { PermissionMode } from "../../../shared/chat.ts";
import { ChevronDownIcon, CircleStopIcon, ClockIcon, HandIcon, ShieldAlertIcon, ShieldCheckIcon, type IconComponent } from "../../components/icons.tsx";
import { Menu, type MenuItem, type MenuSection } from "../../components/Menu.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { end_full_window, full_window_store, open_full_window } from "../../state/full-window.ts";
import { settings_store, update_settings } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";

const modes: { id: PermissionMode; icon: IconComponent; label: MessageKey; hint: MessageKey }[] = [
  { id: "ask", icon: HandIcon, label: "composer.permission_ask", hint: "composer.permission_ask_desc" },
  { id: "auto", icon: ShieldCheckIcon, label: "composer.permission_auto", hint: "composer.permission_auto_desc" },
  { id: "full", icon: ShieldAlertIcon, label: "composer.permission_full", hint: "composer.permission_full_desc" },
];

const remaining_text = (until: number, now: number) => {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const ModePicker = ({ chat_id }: { chat_id: string | null }) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const mode = use_store(settings_store, (state) => state?.mode ?? null);
  const until = use_store(full_window_store, (state) => (chat_id !== null && state.chat_id === chat_id ? state.until : null));
  const now = use_clock(until !== null);

  if (mode === null) {
    return <Skeleton width={72} height={32} radius={9} />;
  }

  const current = modes.find((entry) => entry.id === mode) ?? modes[0];
  const windowed = chat_id !== null && until !== null ? { chat_id, until } : null;
  const Icon = windowed ? ShieldAlertIcon : current.icon;
  const remaining = windowed ? remaining_text(windowed.until, now) : "";
  const label = windowed ? t("composer.full_window", { x: remaining }) : t(current.label);
  const hint = windowed ? t("composer.full_window_desc", { x: remaining }) : t(current.hint);

  const mode_items: MenuItem[] = modes.map((entry) => {
    const EntryIcon = entry.icon;
    return {
      id: entry.id,
      label: t(entry.label),
      icon: <EntryIcon size={15} />,
      checked: entry.id === mode,
      on_select: () => {
        if (windowed) {
          void end_full_window(windowed.chat_id);
        }
        void update_settings({ mode: entry.id });
      },
    };
  });
  if (chat_id !== null && !windowed && mode !== "full") {
    mode_items.push({
      id: "start_window",
      label: t("composer.full_window_start", { n: full_window_minutes }),
      icon: <ClockIcon size={15} />,
      on_select: () => void open_full_window(chat_id),
    });
  }
  const sections: MenuSection[] = [{ id: "modes", label: t("composer.permission_title"), items: mode_items }];
  if (windowed) {
    sections.push({
      id: "window",
      label: hint,
      items: [{ id: "end", label: t("composer.full_window_end"), icon: <CircleStopIcon size={15} />, on_select: () => void end_full_window(windowed.chat_id) }],
    });
  }

  return (
    <>
      <button
        ref={set_anchor}
        type="button"
        className="composer-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.permission_title")}
        title={hint}
        data-open={open}
        data-mode={windowed ? "full" : mode}
        onClick={() => set_open(!open)}
      >
        <Icon size={15} />
        <span className="composer-chip-label">{label}</span>
        <ChevronDownIcon size={14} className="composer-chip-chevron" />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        label={t("composer.permission_title")}
        sections={sections}
        on_close={() => set_open(false)}
        placement="top-start"
        min_width={220}
        className="composer-menu"
      />
    </>
  );
};
