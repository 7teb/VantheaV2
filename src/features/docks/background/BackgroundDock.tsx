import { useEffect } from "react";
import { Button } from "../../../components/Button.tsx";
import { Skeleton, SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { background_store, clear_finished_tasks, load_background } from "../../../state/background.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { use_clock } from "../../../components/use-clock.ts";
import { BackgroundTaskRow } from "./BackgroundTaskRow.tsx";
import "./BackgroundDock.css";

const BackgroundSkeleton = () => (
  <div className="bg-task-list" aria-busy="true">
    {[64, 82, 48].map((width, index) => (
      <div key={index} className="bg-task">
        <div className="bg-task-head">
          <Skeleton width={15} height={15} radius={8} />
          <Skeleton width={`${width}%`} height={12} radius={4} />
        </div>
        <SkeletonLines widths={[36]} height={10} />
      </div>
    ))}
  </div>
);

export const BackgroundDock = ({ visible, chat_id }: DockViewProps) => {
  const t = use_t();
  const status = use_store(background_store, (state) => state.status);
  const tasks = use_store(background_store, (state) => state.tasks);
  const running = tasks.filter((task) => task.status === "running").length;
  const finished = tasks.length - running;
  const now = use_clock(visible && running > 0);

  useEffect(() => {
    if (visible) {
      void load_background(chat_id);
    }
  }, [visible, chat_id]);

  const meta = () => {
    if (running > 0) {
      return t("background.running", { n: running });
    }
    return finished > 0 ? t("background.finished", { n: finished }) : undefined;
  };

  const clear = () => {
    if (chat_id !== null) {
      void clear_finished_tasks(chat_id);
    }
  };

  const body = () => {
    if (status === "loading") {
      return <BackgroundSkeleton />;
    }
    if (status === "failed") {
      return <DockEmpty text={t("background.load_failed")} />;
    }
    if (tasks.length === 0) {
      return <DockEmpty text={t("background.none")} />;
    }
    return (
      <div className="bg-task-list">
        {[...tasks].reverse().map((task) => (
          <BackgroundTaskRow key={task.id} task={task} now={now} />
        ))}
      </div>
    );
  };

  return (
    <DockPanel
      title={<DockTitle label={t("background.title")} meta={meta()} />}
      close_label={t("background.close")}
      actions={
        <Button variant="ghost" disabled={finished === 0 || chat_id === null} onClick={clear}>
          {t("background.clear")}
        </Button>
      }
    >
      <div className="dock-scroll">{body()}</div>
    </DockPanel>
  );
};
