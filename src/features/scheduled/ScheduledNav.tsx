import { CalendarClockIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { row_status } from "../../state/chat-marks-rules.ts";
import { chat_marks_store } from "../../state/chat-marks.ts";
import { scheduled_store } from "../../state/scheduled.ts";
import { open_scheduled, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { StatusMark } from "../sidebar/StatusMark.tsx";
import "./scheduled-sidebar.css";

const use_nav_status = () => {
  const tasks = use_store(scheduled_store, (state) => state.items);
  const waiting = use_store(chat_marks_store, (marks) => tasks.some((task) => task.running && row_status(marks[task.chat_id], true) === "waiting"));
  if (waiting) {
    return "waiting";
  }
  return tasks.some((task) => task.running) ? "running" : null;
};

export const ScheduledNav = () => {
  const t = use_t();
  const current = use_store(ui_store, (state) => state.scheduled_open);
  const status = use_nav_status();
  return (
    <button type="button" className="sidebar-nav-button scheduled-nav" aria-current={current ? "page" : undefined} onClick={open_scheduled}>
      <CalendarClockIcon />
      <span className="sidebar-nav-label">{t("sidebar.scheduled")}</span>
      {status && <StatusMark status={status} />}
    </button>
  );
};
