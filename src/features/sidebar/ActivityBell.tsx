import { useMemo } from "react";
import { IconButton } from "../../components/Button.tsx";
import { BellIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { chat_marks_store } from "../../state/chat-marks.ts";
import { chats_store } from "../../state/chats.ts";
import { toggle_activity_view, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { activity_entries, needs_attention } from "./activity.ts";
import "./ActivityBell.css";

export const ActivityBell = () => {
  const t = use_t();
  const chats = use_store(chats_store, (state) => state.list);
  const marks = use_store(chat_marks_store, (state) => state);
  const showing = use_store(ui_store, (state) => state.sidebar_view === "activity" && !state.sidebar_collapsed);
  const attention = useMemo(() => needs_attention(activity_entries(chats, marks)), [chats, marks]);
  const label = showing ? t("sidebar.activity_close") : t(attention ? "sidebar.activity_attention" : "sidebar.activity");

  return (
    <IconButton className="activity-bell" label={label} active={showing} aria-pressed={showing} onClick={toggle_activity_view}>
      <BellIcon size={16} />
      {attention && <span className="activity-bell-dot" />}
    </IconButton>
  );
};
