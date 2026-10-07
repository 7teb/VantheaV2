import type { ImageModelEntry, ModelCatalog, ModelEntry, SideModelRole } from "../../shared/models.ts";

export const major_effort = "major";

const effort_rank = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const side_roles: SideModelRole[] = ["title", "overseer", "vision", "summarize", "web_answer", "memory"];

type Raw = Record<string, unknown>;

const fail = (where: string, problem: string): never => {
  throw new Error(`models.json: ${where}: ${problem}`);
};

const as_record = (value: unknown, where: string): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : fail(where, "must be an object");

const as_text = (value: unknown, where: string): string =>
  typeof value === "string" && value.trim() ? value : fail(where, "must be a non-empty string");

const as_count = (value: unknown, where: string): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fail(where, "must be a positive integer");

const as_flag = (value: unknown, where: string): boolean => (typeof value === "boolean" ? value : fail(where, "must be true or false"));

const as_texts = (value: unknown, where: string): string[] => {
  if (!Array.isArray(value)) {
    return fail(where, "must be an array of strings");
  }
  return value.map((item, index) => as_text(item, `${where}[${index}]`));
};

const parse_efforts = (value: unknown, where: string): string[] => {
  const efforts = as_texts(value, where);
  const ranks = efforts.map((effort) => effort_rank.indexOf(effort));
  if (ranks.some((rank) => rank < 0)) {
    fail(where, `every effort must be one of ${effort_rank.join(", ")}`);
  }
  if (ranks.some((rank, index) => index > 0 && rank <= (ranks[index - 1] ?? -1))) {
    fail(where, "efforts must be unique and ordered from lowest to highest");
  }
  return efforts;
};

const parse_model = (value: unknown, index: number): ModelEntry => {
  const where = `models[${index}]`;
  const raw = as_record(value, where);
  const id = as_text(raw.id, `${where}.id`);
  const named = `${where} (${id})`;
  const efforts = parse_efforts(raw.efforts, `${named}.efforts`);
  const default_effort = typeof raw.default_effort === "string" ? raw.default_effort : "";
  if (efforts.length ? !efforts.includes(default_effort) : default_effort !== "") {
    fail(`${named}.default_effort`, efforts.length ? "must be one of the model's efforts" : "must be empty when the model has no efforts");
  }
  return {
    id,
    label: as_text(raw.label, `${named}.label`),
    provider: as_text(raw.provider, `${named}.provider`),
    provider_order: as_texts(raw.provider_order, `${named}.provider_order`),
    efforts: efforts.length ? [...efforts, major_effort] : efforts,
    default_effort,
    vision: as_flag(raw.vision, `${named}.vision`),
    context_length: as_count(raw.context_length, `${named}.context_length`),
    max_output: as_count(raw.max_output, `${named}.max_output`),
    reasoning_passback: raw.reasoning_passback === undefined ? false : as_flag(raw.reasoning_passback, `${named}.reasoning_passback`),
  };
};

const parse_image_model = (value: unknown, index: number): ImageModelEntry => {
  const where = `image_models[${index}]`;
  const raw = as_record(value, where);
  const id = as_text(raw.id, `${where}.id`);
  return { id, label: as_text(raw.label, `${where} (${id}).label`), quality: as_flag(raw.quality, `${where} (${id}).quality`) };
};

const parse_side = (value: unknown): Record<SideModelRole, string> => {
  const raw = as_record(value, "side");
  const entries = side_roles.map((role) => [role, as_text(raw[role], `side.${role}`)] as const);
  return Object.fromEntries(entries) as Record<SideModelRole, string>;
};

const unique_ids = (ids: string[], where: string) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      fail(where, `duplicate id ${id}`);
    }
    seen.add(id);
  }
};

export const parse_catalog = (value: unknown): ModelCatalog => {
  const raw = as_record(value, "root");
  if (!Array.isArray(raw.models) || !raw.models.length) {
    return fail("models", "must be a non-empty array");
  }
  if (!Array.isArray(raw.image_models)) {
    return fail("image_models", "must be an array");
  }
  const models = raw.models.map(parse_model);
  const image_models = raw.image_models.map(parse_image_model);
  unique_ids(
    models.map((model) => model.id),
    "models",
  );
  unique_ids(
    image_models.map((model) => model.id),
    "image_models",
  );
  return { models, side: parse_side(raw.side), image_models };
};

export const find_model = (catalog: ModelCatalog, id: string): ModelEntry | null => catalog.models.find((model) => model.id === id) ?? null;

export const resolve_effort = (model: ModelEntry, effort: string): string => (model.efforts.includes(effort) ? effort : model.default_effort);

export const api_effort = (model: ModelEntry, effort: string): string => {
  const chosen = resolve_effort(model, effort);
  if (chosen !== major_effort) {
    return chosen;
  }
  return model.efforts.filter((item) => item !== major_effort).at(-1) ?? model.default_effort;
};
