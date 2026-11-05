import type { PermissionMode } from "../../../shared/chat.ts";
import { model_listing, type ModelCatalog, type ModelChoice } from "../../../shared/models.ts";
import type { ScheduledInput, ScheduledTaskView, ScheduleInterval } from "../../../shared/scheduled.ts";
import type { ProjectEntry, Settings } from "../../../shared/settings.ts";
import { normalize_path } from "../sidebar/sidebar-model.ts";

export type ScheduledForm = {
  name: string;
  prompt: string;
  interval: ScheduleInterval;
  choice: ModelChoice;
  mode: PermissionMode;
  project_path: string;
};

export type FormDefaults = {
  settings: Pick<Settings, "model" | "effort" | "mode" | "projects">;
  catalog: ModelCatalog | null;
  project_path: string;
};

const listed_project = (projects: readonly ProjectEntry[], path: string): string =>
  path ? (projects.find((project) => normalize_path(project.path) === normalize_path(path))?.path ?? "") : "";

const default_choice = ({ settings, catalog }: FormDefaults): ModelChoice => {
  const entry = model_listing(catalog?.models ?? [], settings.model)?.entry ?? catalog?.models[0];
  if (!entry) {
    return { model: settings.model, effort: settings.effort, pro: false };
  }
  const effort = entry.efforts.includes(settings.effort) ? settings.effort : entry.default_effort;
  return { model: entry.id, effort, pro: false };
};

export const initial_form = (task: ScheduledTaskView | null, defaults: FormDefaults): ScheduledForm => {
  if (task) {
    const project_path = listed_project(defaults.settings.projects, task.project_path) || task.project_path;
    return { name: task.name, prompt: task.prompt, interval: task.interval, choice: task.choice, mode: task.mode, project_path };
  }
  return {
    name: "",
    prompt: "",
    interval: "1h",
    choice: default_choice(defaults),
    mode: defaults.settings.mode,
    project_path: listed_project(defaults.settings.projects, defaults.project_path),
  };
};

export const with_choice_change = (current: ModelChoice, next: ModelChoice): ModelChoice =>
  next.model === current.model ? next : { model: next.model, effort: next.effort, pro: false };

export const form_ready = (form: ScheduledForm): boolean => form.name.trim() !== "" && form.prompt.trim() !== "";

export const form_input = (form: ScheduledForm, enabled: boolean): ScheduledInput => ({
  name: form.name.trim(),
  prompt: form.prompt.trim(),
  interval: form.interval,
  enabled,
  choice: form.choice,
  mode: form.mode,
  project_path: form.project_path,
});
