import type { WorkflowPhase } from "../../shared/workflow.ts";
import { line_column, LiteralError, parse_literal, skip_space } from "./literal.ts";

export type RoleSpec = { profile: "explore" | "worker"; instructions: string; model: string; effort: string; description: string };

export type WorkflowMeta = {
  name: string;
  description: string;
  when_to_use: string;
  phases: WorkflowPhase[];
  roles: Record<string, RoleSpec>;
};

export type ReadScript = { meta: WorkflowMeta; body: string };

export class ScriptError extends Error {}

const meta_keys = ["name", "description", "whenToUse", "phases", "roles"];

const phase_keys = ["title", "detail", "model"];

const role_keys = ["profile", "instructions", "model", "effort", "description"];

const head = /^export\s+const\s+meta\s*=/;

const is_object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const unknown_keys = (value: Record<string, unknown>, allowed: string[], where: string) => {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw new ScriptError(`${where} has unknown key${extra.length === 1 ? "" : "s"} ${extra.join(", ")}; allowed keys: ${allowed.join(", ")}`);
  }
};

const text_field = (value: Record<string, unknown>, key: string, where: string, required: boolean): string => {
  const field = value[key];
  if (field === undefined && !required) {
    return "";
  }
  if (typeof field !== "string" || (required && !field.trim())) {
    throw new ScriptError(`${where}.${key} must be ${required ? "a non-empty" : "a"} string`);
  }
  return field.trim();
};

const read_phase = (value: unknown, index: number): WorkflowPhase => {
  const where = `meta.phases[${index}]`;
  if (!is_object(value)) {
    throw new ScriptError(`${where} must be an object like { title: 'Scan', detail: '...' }`);
  }
  unknown_keys(value, phase_keys, where);
  return { title: text_field(value, "title", where, true), detail: text_field(value, "detail", where, false), model: text_field(value, "model", where, false) };
};

export const read_role = (value: unknown, where: string): RoleSpec => {
  if (!is_object(value)) {
    throw new ScriptError(`${where} must be an object like { profile: 'explore', instructions: '...' }`);
  }
  unknown_keys(value, role_keys, where);
  const profile = value.profile ?? "worker";
  if (profile !== "explore" && profile !== "worker") {
    throw new ScriptError(`${where}.profile must be explore or worker`);
  }
  return {
    profile,
    instructions: text_field(value, "instructions", where, false),
    model: text_field(value, "model", where, false),
    effort: text_field(value, "effort", where, false),
    description: text_field(value, "description", where, false),
  };
};

export const role_name_ok = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);

const read_roles = (value: unknown): Record<string, RoleSpec> => {
  if (value === undefined) {
    return {};
  }
  if (!is_object(value)) {
    throw new ScriptError("meta.roles must be an object that maps role names to role definitions");
  }
  const roles: Record<string, RoleSpec> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (!role_name_ok(name)) {
      throw new ScriptError(`meta.roles.${name}: role names use letters, digits, - and _ and start with a letter or digit`);
    }
    if (name === "explore" || name === "worker") {
      throw new ScriptError(`meta.roles.${name}: explore and worker are the built-in roles and cannot be redefined`);
    }
    roles[name] = read_role(spec, `meta.roles.${name}`);
  }
  return roles;
};

const read_meta = (value: unknown): WorkflowMeta => {
  if (!is_object(value)) {
    throw new ScriptError("meta must be an object literal");
  }
  unknown_keys(value, meta_keys, "meta");
  const description = text_field(value, "description", "meta", true);
  if (/[\r\n]/.test(description)) {
    throw new ScriptError("meta.description must be one line");
  }
  const phases = value.phases;
  if (phases !== undefined && !Array.isArray(phases)) {
    throw new ScriptError("meta.phases must be an array of { title, detail? } objects");
  }
  return {
    name: text_field(value, "name", "meta", true),
    description,
    when_to_use: text_field(value, "whenToUse", "meta", false),
    phases: (phases ?? []).map(read_phase),
    roles: read_roles(value.roles),
  };
};

export const read_script = (source: string): ReadScript => {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let start: number;
  try {
    start = skip_space(text, 0);
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message : String(error));
  }
  const match = head.exec(text.slice(start));
  if (!match) {
    throw new ScriptError("A workflow script must start with export const meta = { name: '...', description: '...' } (only comments and blank lines may come before it)");
  }
  let parsed: { value: unknown; end: number };
  try {
    parsed = parse_literal(text, start + match[0].length);
  } catch (error) {
    if (error instanceof LiteralError) {
      throw new ScriptError(`meta at ${line_column(text, error.at)}: ${error.message}`);
    }
    throw error;
  }
  const meta = read_meta(parsed.value);
  const body = `${text.slice(0, start)}${" ".repeat("export".length)}${text.slice(start + "export".length)}`;
  return { meta, body };
};

export const syntax_hint = "Workflow scripts are plain JavaScript run as the body of one async function: no TypeScript annotations, no import or export besides the meta export.";

export const wrap_body = (body: string): string => `(async (agent, parallel, pipeline, phase, log, args, workflow) => { "use strict"; ${body}\n})`;
