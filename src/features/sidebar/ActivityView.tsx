import { useMemo } from "react";
import type { ChatMeta } from "../../../shared/chat.ts";
import { Button } from "../../components/Button.tsx";
import { use_language, use_t, type MessageKey } from "../../i18n/index.ts";
import { chat_marks_store, read_all_marks } from "../../state/chat-marks.ts";
import { chats_store } from "../../state/chats.ts";
import { use_store } from "../../state/use-store.ts";
import { base_name } from "../tools/tool-meta.ts";
import { activity_entries, day_groups, needs_attention, type DayGroup } from "./activity.ts";
import { ChatRow } from "./ChatRow.tsx";
import { SidebarSection } from "./SidebarSection.tsx";

const day_keys: Record<Exclude<DayGroup["kind"], "weekday">, MessageKey> = {
  today: "sidebar.today",
  yesterday: "sidebar.yesterday",
  older: "sidebar.older",
};

type ActivityViewProps = { active_chat_id: string | null; now: number };

export const ActivityView = ({ active_chat_id, now }: ActivityViewProps) => {
  const t = use_t();
  const language = use_language();
  const chats = use_store(chats_store, (state) => state.list);
  const marks = use_store(chat_marks_store, (state) => state);
  const entries = useMemo(() => activity_entries(chats, marks), [chats, marks]);
  const groups = useMemo(() => day_groups(chats, new Set(entries.map((entry) => entry.chat.id)), now), [chats, entries, now]);
  const weekday = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "long" }), [language]);

  const row = (chat: ChatMeta) => (
    <ChatRow key={chat.id} chat={chat} active={chat.id === active_chat_id} now={now} detail={chat.project_path ? base_name(chat.project_path) : t("sidebar.no_project")} />
  );

  return (
    <div className="sidebar-sections enter-fade-up">
      <SidebarSection
        label={t("sidebar.priority")}
        action={
          needs_attention(entries) ? (
            <Button variant="ghost" size="sm" onClick={read_all_marks}>
              {t("sidebar.mark_all_read")}
            </Button>
          ) : undefined
        }
      >
        {entries.length === 0 ? <div className="sidebar-empty">{t("sidebar.activity_empty")}</div> : entries.map((entry) => row(entry.chat))}
      </SidebarSection>
      {groups.map((group) => (
        <SidebarSection key={`${group.kind}:${group.day_start}`} label={group.kind === "weekday" ? weekday.format(group.day_start) : t(day_keys[group.kind])}>
          {group.chats.map(row)}
        </SidebarSection>
      ))}
    </div>
  );
};
