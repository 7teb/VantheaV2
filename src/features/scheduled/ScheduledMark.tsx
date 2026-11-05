import { CalendarClockIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { scheduled_store } from "../../state/scheduled.ts";
import { use_store } from "../../state/use-store.ts";
import "./scheduled-sidebar.css";

export const ScheduledMark = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const enabled = use_store(scheduled_store, (state) => state.items.find((task) => task.chat_id === chat_id)?.enabled ?? null);
  if (enabled === null) {
    return null;
  }
  return (
    <span className="scheduled-mark" role="img" aria-label={t(enabled ? "sidebar.scheduled_mark" : "sidebar.scheduled_mark_off")} data-enabled={enabled}>
      <CalendarClockIcon />
    </span>
  );
};
