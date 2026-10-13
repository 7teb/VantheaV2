import { against_location, type Step, type Value } from "./command-walk.ts";

export type StepWrite = { files: string[]; text: string };

const writers = /^(?:set-content|sc|out-file|new-item|ni)$/;

const path_params = /^(?:path|literalpath|lp|pspath|filepath)$/;

const value_params = /^(?:value|inputobject)$/;

const other_values = /^(?:encoding|filter|include|exclude|credential|stream|width|itemtype|type|name)$/;

const single = (value: Value | null | undefined): string | null => (value && "values" in value && value.values.length === 1 && !value.list ? (value.values[0] ?? null) : null);

export const step_write = (step: Step): StepWrite | null => {
  const name = (single(step.words[0]?.value) ?? "").toLowerCase();
  if (step.dialect !== "powershell" || !step.command || !writers.test(name)) return null;
  let target: Value | null = null;
  let value: Value | null = step.input;
  let positional = 0;
  for (let index = 1; index < step.words.length; index += 1) {
    const word = step.words[index];
    if (!word || word.word.op) return null;
    const flag = /^-(\w+):?$/.exec(word.word.raw)?.[1]?.toLowerCase();
    const next = step.words[index + 1]?.value ?? null;
    if (flag && path_params.test(flag)) target = next;
    else if (flag && value_params.test(flag)) value = next;
    else if (!flag && positional === 0) target = word.value;
    else if (!flag && positional === 1 && name !== "out-file" && name !== "new-item" && name !== "ni") value = word.value;
    if (flag && (path_params.test(flag) || value_params.test(flag) || other_values.test(flag))) index += 1;
    if (!flag) positional += 1;
  }
  const text = single(value);
  if (!target || text === null || ("values" in target && target.values.some((entry) => /[*?[]/.test(entry)))) return null;
  const files = against_location(target, step.location);
  return "values" in files ? { files: files.values, text } : null;
};
