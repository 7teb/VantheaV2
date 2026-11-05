import { useState, type CSSProperties, type FormEvent } from "react";
import type { PermissionMode } from "../../../shared/chat.ts";
import { schedule_intervals, type ScheduledTaskView, type ScheduleInterval } from "../../../shared/scheduled.ts";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Select } from "../../components/Select.tsx";
import { TextArea, TextField } from "../../components/TextField.tsx";
import { use_t } from "../../i18n/index.ts";
import { models_store } from "../../state/models.ts";
import { save_scheduled } from "../../state/scheduled.ts";
import { settings_store } from "../../state/settings.ts";
import { ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { mode_options } from "../composer/ModePicker.tsx";
import { ipc_error_text } from "../settings/panes/ipc-error.ts";
import { project_label, project_path_label } from "../sidebar/sidebar-model.ts";
import { ModelField } from "./ModelField.tsx";
import { form_input, form_ready, initial_form, with_choice_change, type ScheduledForm } from "./scheduled-form.ts";
import "./ScheduledDialog.css";

type ScheduledDialogProps = { open: boolean; task: ScheduledTaskView | null; on_close: () => void };

const row = (index: number) => ({ "--row": index }) as CSSProperties;

export const ScheduledDialog = ({ open, task, on_close }: ScheduledDialogProps) => {
  const t = use_t();
  const settings = use_store(settings_store, (state) => state);
  const catalog = use_store(models_store, (state) => state.catalog);
  const [form, set_form] = useState<ScheduledForm | null>(null);
  const [opened, set_opened] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);
  if (open !== opened) {
    set_opened(open);
    if (open) {
      set_form(null);
      set_error(null);
    }
  }
  if (open === opened && open && form === null && settings) {
    set_form(initial_form(task, { settings, catalog, project_path: ui_store.get().project_path }));
  }

  const title = task ? t("scheduled.edit_title") : t("scheduled.create_title");
  const field = <K extends keyof ScheduledForm>(key: K) => (value: ScheduledForm[K]) => set_form((current) => (current ? { ...current, [key]: value } : current));
  const projects = settings?.projects ?? [];
  const project_options = [
    { id: "", label: t("sidebar.no_project") },
    ...projects.map((project) => ({ id: project.path, label: project_label(project) })),
    ...(form && form.project_path && !projects.some((project) => project.path === form.project_path) ? [{ id: form.project_path, label: project_path_label(projects, form.project_path) }] : []),
  ];
  const ready = form !== null && form_ready(form);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !ready || busy) {
      return;
    }
    set_busy(true);
    set_error(null);
    try {
      await save_scheduled(form_input(form, task?.enabled ?? true), task?.id ?? null);
      on_close();
    } catch (failure) {
      console.error(`[scheduled] scheduled:save failed for task ${task?.id ?? "(new)"}`, failure);
      set_error(t("scheduled.save_failed", { x: ipc_error_text(failure) }));
    } finally {
      set_busy(false);
    }
  };

  return (
    <Dialog open={open} on_close={on_close} label={title} className="scheduled-dialog">
      {form && (
        <form className="scheduled-form" onSubmit={save}>
          <h2 className="scheduled-dialog-title" style={row(0)}>
            {title}
          </h2>
          <div className="dialog-field" style={row(1)}>
            <span className="dialog-field-label">{t("scheduled.name_label")}</span>
            <TextField value={form.name} maxLength={200} placeholder={t("scheduled.name_placeholder")} aria-label={t("scheduled.name_label")} on_change={field("name")} />
          </div>
          <label className="dialog-field" style={row(2)}>
            <span className="dialog-field-label">{t("scheduled.prompt_label")}</span>
            <TextArea className="scheduled-prompt-input" value={form.prompt} rows={4} auto_grow max_height={240} placeholder={t("scheduled.prompt_placeholder")} on_change={field("prompt")} />
          </label>
          <div className="dialog-field" style={row(3)}>
            <span className="dialog-field-label">{t("scheduled.schedule_label")}</span>
            <Segmented<ScheduleInterval>
              size="lg"
              label={t("scheduled.schedule_label")}
              value={form.interval}
              options={schedule_intervals.map((interval) => ({ id: interval, label: t(`scheduled.interval_${interval}`), detail: t(`scheduled.every_${interval}`) }))}
              on_change={field("interval")}
            />
          </div>
          <div className="scheduled-form-pair" style={row(4)}>
            <div className="dialog-field">
              <span className="dialog-field-label">{t("scheduled.model_label")}</span>
              <ModelField choice={form.choice} label={t("scheduled.model_label")} on_change={(next) => field("choice")(with_choice_change(form.choice, next))} />
            </div>
            <div className="dialog-field">
              <span className="dialog-field-label">{t("scheduled.project_label")}</span>
              <Select
                className="scheduled-select"
                label={t("scheduled.project_label")}
                value={form.project_path}
                placement="bottom-start"
                options={project_options}
                on_change={field("project_path")}
              />
            </div>
          </div>
          <div className="dialog-field" style={row(5)}>
            <span className="dialog-field-label">{t("composer.permission_title")}</span>
            <Segmented<PermissionMode>
              className="scheduled-mode"
              label={t("composer.permission_title")}
              value={form.mode}
              options={mode_options.map((entry) => ({ id: entry.id, label: t(entry.label), icon: <entry.icon className={entry.id === "full" ? "mode-danger-icon" : undefined} /> }))}
              on_change={field("mode")}
            />
          </div>
          {error && (
            <p className="scheduled-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="scheduled-dialog-actions" style={row(6)}>
            <Button variant="ghost" onClick={on_close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {task ? t("scheduled.save") : t("scheduled.create")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
