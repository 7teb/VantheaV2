import { deepseek_call_begin, deepseek_calls_begin } from "./content-split.ts";
import { create_code_tracker } from "./markdown-code.ts";

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

const read_call = (match: RegExpExecArray): RecoveredCall | null => {
  if (match[0].startsWith("<tool_call>")) {
    return tagged(match[1] ?? "");
  }
  const name = match[1] ?? match[3] ?? "";
  const args = object_text(match[2] ?? match[4] ?? "");
  return name && args !== null ? { name, arguments: args } : null;
};

export const recover_tool_calls = (held: string, known: Set<string>): Recovery => {
  const calls: RecoveredCall[] = [];
  let rest = "";
  const matches = [...held.matchAll(tagged_call), ...held.matchAll(deepseek_call)].sort((a, b) => a.index - b.index);
  const code = create_code_tracker();
  let position = 0;
  let kept = 0;
  for (const match of matches) {
    if (match.index < position) {
      continue;
    }
    code.feed(held.slice(position, match.index));
    position = match.index;
    if (code.inside()) {
      continue;
    }
    code.skip(match[0]);
    position = match.index + match[0].length;
    const call = read_call(match);
    if (!call || !known.has(call.name)) {
      continue;
    }
    calls.push(call);
    rest += held.slice(kept, match.index);
    kept = position;
  }
  rest += held.slice(kept);
  if (calls.length) {
    rest = rest.replaceAll(deepseek_calls_begin, "").replaceAll(deepseek_calls_end, "");
  }
  return { calls, rest: calls.length ? rest.trim() : held };
};
