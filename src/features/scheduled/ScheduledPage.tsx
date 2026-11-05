import { Fragment, useMemo, useState, type AnimationEvent } from "react";
import type { ScheduledTaskView } from "../../../shared/scheduled.ts";
import { Button } from "../../components/Button.tsx";
import { PlusIcon } from "../../components/icons.tsx";
import { use_minute_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { chats_store } from "../../state/chats.ts";
import { load_scheduled, scheduled_store } from "../../state/scheduled.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { use_leaving_rows } from "../composer/use-leaving-rows.ts";
import { chat_label, project_path_label } from "../sidebar/sidebar-model.ts";
import { ScheduledDialog } from "./ScheduledDialog.tsx";
import { ScheduledEmpty } from "./ScheduledEmpty.tsx";
import { ScheduledRow } from "./ScheduledRow.tsx";
import { ScheduledSkeleton } from "./ScheduledSkeleton.tsx";
import { soonest_id } from "./scheduled-time.ts";
import { page_order } from "./task-state.ts";
import "./ScheduledPage.css";

type DialogState = { open: boolean; task: ScheduledTaskView | null };

export const ScheduledPage = () => {
  const t = use_t();
  const now = use_minute_clock();
  const scheduled = use_store(scheduled_store, (state) => state);
  const chats = use_store(chats_store, (state) => state.list);
  const projects = use_store(settings_store, (state) => state?.projects ?? []);
  const [dialog, set_dialog] = useState<DialogState>({ open: false, task: null });
  const live = useMemo(() => {
    const by_id = new Map(chats.map((chat) => [chat.id, chat]));
    return scheduled.items.map((task) => {
      const chat = by_id.get(task.chat_id);
      return chat ? { ...task, name: chat.title, project_path: chat.project_path } : task;
    });
  }, [scheduled.items, chats]);
  const ordered = useMemo(() => [...live].sort(page_order), [live]);
  const soonest = useMemo(() => soonest_id(live), [live]);
  const { rows, finish } = use_leaving_rows(ordered);
  const first_paused = rows.find((row) => !row.item.enabled)?.item.id ?? null;
  const loading = scheduled.status === "loading";
  const empty = scheduled.status === "ready" && live.length === 0 && rows.length === 0;

  const open_dialog = (task: ScheduledTaskView | null) => set_dialog({ open: true, task });

  const left = (id: string) => (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      finish(id);
    }
  };

  const body = () => {
    if (scheduled.status === "failed") {
      return (
        <div className="scheduled-failed">
          <span>{t("scheduled.load_failed")}</span>
          <Button variant="ghost" onClick={() => void load_scheduled()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }
    if (loading) {
      return <ScheduledSkeleton />;
    }
    if (empty) {
      return <ScheduledEmpty on_create={() => open_dialog(null)} />;
    }
    return (
      <div className="scheduled-list">
        {rows.map(({ item, leaving }, index) => (
          <Fragment key={item.id}>
            {item.id === first_paused && <div className="scheduled-section-label section-label">{t("scheduled.paused")}</div>}
            <div className="scheduled-slot" data-leaving={leaving} onAnimationEnd={leaving ? left(item.id) : undefined}>
              <div className="scheduled-slot-clip">
                <ScheduledRow
                  task={item}
                  name={chat_label(t, item.name)}
                  project={item.project_path ? project_path_label(projects, item.project_path) : t("sidebar.no_project")}
                  index={index}
                  now={now}
                  soonest={item.id === soonest}
                  on_edit={open_dialog}
                />
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="scheduled-page">
      <div className="scheduled-column">
        <div className="scheduled-head enter-fade-up">
          <h1 className="scheduled-title">
            {t("scheduled.title")}
            {live.length > 0 && <span className="scheduled-count">{live.length}</span>}
          </h1>
          {!empty && scheduled.status !== "failed" && (
            <Button icon={<PlusIcon />} disabled={loading} onClick={() => open_dialog(null)}>
              {t("scheduled.new")}
            </Button>
          )}
        </div>
        {body()}
      </div>
      <ScheduledDialog open={dialog.open} task={dialog.task} on_close={() => set_dialog((current) => ({ ...current, open: false }))} />
    </div>
  );
};
