import { deepseek_call_begin, deepseek_calls_begin } from "./content-split.ts";

export type RecoveredCall = { name: string; arguments: string };

export type Recovery = { calls: RecoveredCall[]; rest: string };

const deepseek_sep = "<｜tool▁sep｜>";

const deepseek_call_end = "<｜tool▁call▁end｜>";

const deepseek_calls_end = "<｜tool▁calls▁end｜>";

const tagged_call = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

const deepseek_call = new RegExp(
  `${deepseek_call_begin}\\s*(?:function\\s*${deepseek_sep}\\s*([\\w.-]+)\\s*\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`|([\\w.-]+)\\s*${deepseek_sep}\\s*([\\s\\S]*?))\\s*${deepseek_call_end}`,
  "g",
);

const object_text = (value: unknown): string | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? value.trim() : null;
  } catch (error) {
    console.warn(`[model] recovered tool arguments are not JSON (${String(error)}): ${value.slice(0, 200)}`);
    return null;
  }
};

const tagged = (body: string): RecoveredCall | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    console.warn(`[model] <tool_call> body is not JSON (${String(error)}): ${body.slice(0, 200)}`);
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const call = parsed as { name?: unknown; arguments?: unknown; parameters?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const name = typeof call.name === "string" ? call.name : typeof call.function?.name === "string" ? call.function.name : "";
  const args = object_text(call.arguments ?? call.parameters ?? call.function?.arguments ?? {});
  return name && args !== null ? { name, arguments: args } : null;
};

export const recover_tool_calls = (held: string, known: Set<string>): Recovery => {
  const calls: RecoveredCall[] = [];
  let rest = held;
  const take = (raw: string, call: RecoveredCall | null) => {
    if (!call || !known.has(call.name)) {
      return;
    }
    calls.push(call);
    rest = rest.replace(raw, "");
  };
  for (const match of held.matchAll(tagged_call)) {
    take(match[0], tagged(match[1] ?? ""));
  }
  for (const match of held.matchAll(deepseek_call)) {
    const name = match[1] ?? match[3] ?? "";
    const args = object_text(match[2] ?? match[4] ?? "");
    take(match[0], name && args !== null ? { name, arguments: args } : null);
  }
  if (calls.length) {
    rest = rest.replaceAll(deepseek_calls_begin, "").replaceAll(deepseek_calls_end, "");
  }
  return { calls, rest: calls.length ? rest.trim() : held };
};
