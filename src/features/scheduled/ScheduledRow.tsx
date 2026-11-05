import { useId, useState, type CSSProperties } from "react";
import type { ScheduledTaskView } from "../../../shared/scheduled.ts";
import { IconButton } from "../../components/Button.tsx";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../components/Dialog.tsx";
import { MoreHorizontalIcon, PencilIcon, PlayIcon, ShieldAlertIcon, TrashIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Toggle } from "../../components/Toggle.tsx";
import { use_t } from "../../i18n/index.ts";
import { row_status } from "../../state/chat-marks-rules.ts";
import { chat_marks_store } from "../../state/chat-marks.ts";
import { chats_store } from "../../state/chats.ts";
import { models_store } from "../../state/models.ts";
import { remove_scheduled, run_scheduled_now, set_scheduled_enabled } from "../../state/scheduled.ts";
import { open_chat } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label } from "../composer/composer-hooks.ts";
import { choice_view } from "../composer/model-menu.ts";
import { ipc_error_text } from "../settings/panes/ipc-error.ts";
import { RunStatus } from "./RunStatus.tsx";
import { RunTrail } from "./RunTrail.tsx";
import { ScheduleDial } from "./ScheduleDial.tsx";
import { card_state, dial_state, status_kind, trail_marks } from "./task-state.ts";
import "./ScheduledRow.css";

type ScheduledRowProps = {
  task: ScheduledTaskView;
  name: string;
  project: string;
  index: number;
  now: number;
  soonest: boolean;
  on_edit: (task: ScheduledTaskView) => void;
};

type Pending = "run" | "toggle" | "delete" | null;

const ModelMeta = ({ task }: { task: ScheduledTaskView }) => {
  const t = use_t();
  const catalog = use_store(models_store, (state) => state.catalog);
  const shown = catalog ? choice_view(catalog, task.choice) : null;
  return (
    <span className="scheduled-meta-item">
      <span className="scheduled-meta-model">{shown?.model?.label ?? task.choice.model}</span>
      {shown?.model && shown.model.efforts.length > 0 && <span>{effort_label(t, shown.effort)}</span>}
    </span>
  );
};

export const ScheduledRow = ({ task, name, project, index, now, soonest, on_edit }: ScheduledRowProps) => {
  const t = use_t();
  const name_id = useId();
  const error_id = useId();
  const [menu_anchor, set_menu_anchor] = useState<HTMLButtonElement | null>(null);
  const [menu_open, set_menu_open] = useState(false);
  const [confirming, set_confirming] = useState(false);
  const [open_error, set_open_error] = useState<string | null>(null);
  const [pending, set_pending] = useState<Pending>(null);
  const [note, set_note] = useState<string | null>(null);
  const mark = use_store(chat_marks_store, (marks) => marks[task.chat_id]);
  const chat_streaming = use_store(chats_store, (state) => state.list.find((chat) => chat.id === task.chat_id)?.streaming ?? false);
  const waiting = task.running && row_status(mark, true) === "waiting";
  const kind = status_kind(task, waiting);
  const marks = trail_marks(task);
  const error = kind === "failed" ? task.last_run?.error : null;
  const run_key = task.last_run?.started_at ?? null;
  const error_open = run_key !== null && open_error === run_key;

  const act = async (action: Exclude<Pending, null>, channel: string, run: () => Promise<void>, failed: (text: string) => string) => {
    set_pending(action);
    set_note(null);
    try {
      await run();
    } catch (failure) {
      console.error(`[scheduled] scheduled:${channel} failed for task ${task.id}`, failure);
      set_note(failed(ipc_error_text(failure)));
    } finally {
      set_pending(null);
    }
  };

  const run_now = () => act("run", "run_now", () => run_scheduled_now(task.id), (x) => t("scheduled.run_failed", { x }));
  const toggle = (enabled: boolean) => act("toggle", "set_enabled", () => set_scheduled_enabled(task.id, enabled), (x) => t("scheduled.save_failed", { x }));
  const remove = () => act("delete", "remove", () => remove_scheduled(task.id), (x) => t("scheduled.delete_failed", { x }));

  return (
    <article
      className="scheduled-card raised-surface"
      data-state={card_state(task, waiting)}
      data-enabled={task.enabled}
      data-soonest={soonest}
      style={{ "--row": index } as CSSProperties}
      aria-labelledby={name_id}
    >
      <button type="button" className="scheduled-open" aria-label={t("scheduled.open", { x: name })} onClick={() => open_chat(task.chat_id, task.project_path)} />
      <ScheduleDial task={task} state={dial_state(task, waiting)} now={now} />
      <div className="scheduled-card-head">
        <h3 id={name_id} className="scheduled-name">
          {name}
        </h3>
      </div>
      <div className="scheduled-controls">
        <IconButton size="sm" className="scheduled-run-now" label={t("scheduled.run_now")} disabled={task.running || chat_streaming || pending !== null} onClick={() => void run_now()}>
          <PlayIcon />
        </IconButton>
        <Toggle checked={task.enabled} label={t("scheduled.enabled", { x: name })} disabled={pending === "toggle"} on_change={(enabled) => void toggle(enabled)} />
        <IconButton
          ref={set_menu_anchor}
          size="sm"
          label={t("scheduled.options")}
          aria-haspopup="menu"
          aria-expanded={menu_open}
          active={menu_open}
          onClick={() => set_menu_open((was_open) => !was_open)}
        >
          <MoreHorizontalIcon />
        </IconButton>
      </div>
      <div className="scheduled-body">
        <p className="scheduled-prompt">{task.prompt}</p>
        <div className="scheduled-meta">
          <ModelMeta task={task} />
          <span className="scheduled-meta-item">{project}</span>
          {task.mode === "full" && (
            <span className="scheduled-meta-item">
              <ShieldAlertIcon className="mode-danger-icon" />
              {t("composer.permission_full")}
            </span>
          )}
        </div>
      </div>
      <div className="scheduled-foot">
        {marks.length > 0 && <RunTrail marks={marks} now={now} />}
        <RunStatus task={task} kind={kind} unread={mark?.unread ?? false} now={now} error_id={error ? error_id : null} error_open={error_open} on_error_toggle={() => set_open_error(error_open ? null : run_key)} />
        <span className="scheduled-every">{t(`scheduled.every_${task.interval}`)}</span>
      </div>
      {error && (
        <CollapsibleBody id={error_id} open={error_open} className="scheduled-error">
          <p className="scheduled-error-text">{error}</p>
        </CollapsibleBody>
      )}
      {note && (
        <p className="scheduled-note" role="alert">
          {note}
        </p>
      )}
      <Menu
        open={menu_open}
        anchor={menu_anchor}
        label={t("scheduled.options")}
        placement="bottom-end"
        min_width={160}
        on_close={() => set_menu_open(false)}
        sections={[
          {
            id: "task",
            items: [
              { id: "edit", label: t("scheduled.edit"), icon: <PencilIcon />, on_select: () => on_edit(task) },
              { id: "delete", label: t("scheduled.delete"), icon: <TrashIcon />, danger: true, disabled: pending === "delete", on_select: () => set_confirming(true) },
            ],
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title={t("scheduled.delete_title")}
        detail={name}
        confirm_label={t("common.delete")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => void remove()}
        on_close={() => set_confirming(false)}
      >
        <p className="scheduled-confirm-note">{t("scheduled.delete_keeps_chat")}</p>
      </ConfirmDialog>
    </article>
  );
};
