import { permission_modes } from "../../shared/chat.ts";
import { catalog_choice, type ModelCatalog } from "../../shared/models.ts";
import { schedule_intervals, type ScheduledInput } from "../../shared/scheduled.ts";
import { parse_choice } from "../chats/files.ts";
import { find_project } from "../settings/store.ts";
import { require_boolean, require_record, require_string } from "../storage/coerce.ts";
import { scheduled_task } from "./store.ts";

export const max_name_chars = 200;

export const parse_task_id = (value: unknown): string => {
  const id = require_string(value, "scheduled task id", 200);
  if (!scheduled_task(id)) {
    throw new Error(`scheduled task ${id} not found`);
  }
  return id;
};

const required_text = (value: unknown, label: string, max_length?: number): string => {
  const text = require_string(value, label, max_length).trim();
  if (!text) {
    throw new Error(`${label} must not be empty`);
  }
  return text;
};

const project_of = (value: unknown): string => {
  const path = require_string(value, "task project path", 2000);
  if (!path) {
    return "";
  }
  const project = find_project(path);
  if (!project) {
    throw new Error(`${path} is not a project in VantheaX`);
  }
  return project.path;
};

export const parse_scheduled_input = (value: unknown, catalog: ModelCatalog): ScheduledInput => {
  const raw = require_record(value, "scheduled task");
  const interval = schedule_intervals.find((entry) => entry === raw.interval);
  if (!interval) {
    throw new Error(`task schedule must be one of ${schedule_intervals.join(", ")}`);
  }
  const mode = permission_modes.find((entry) => entry === raw.mode);
  if (!mode) {
    throw new Error(`task permission mode must be one of ${permission_modes.join(", ")}`);
  }
  const parsed = parse_choice(raw.choice);
  if (!parsed) {
    throw new Error("task model choice needs a model id");
  }
  const choice = catalog_choice(catalog.models, parsed);
  if (!catalog.models.some((model) => model.id === choice.model)) {
    throw new Error(`model ${choice.model} is not in the catalog`);
  }
  return {
    name: required_text(raw.name, "task name", max_name_chars),
    prompt: required_text(raw.prompt, "task prompt"),
    interval,
    enabled: require_boolean(raw.enabled, "task enabled"),
    choice,
    mode,
    project_path: project_of(raw.project_path),
  };
};
