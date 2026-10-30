import path from "node:path";
import { get_chat } from "../../chats/store.ts";
import type { ToolContext } from "../types.ts";

export const style_marker = "An automatic check flagged your last code change";

const max_notes = 2;

const code_extensions = new Set([
  "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "inl", "ipp", "cs", "java", "kt", "kts", "scala", "go", "rs", "swift", "m", "mm",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte", "css", "scss", "less", "py", "pyw", "rb", "php", "lua", "pl", "pm",
  "sh", "bash", "zsh", "ps1", "psm1", "bat", "cmd", "asm", "s", "inc", "nasm", "vb", "vbs", "fs", "fsx", "dart", "zig", "nim", "sql", "r", "jl",
]);

const comment_start = /^\s*(?:\/\/|\/\*|\*|#|;|--|'|::|rem\s)/i;
const long_run = /([=\-#*~_])\1{9,}/;
const only_run = /^\s*[=\-#*~_]{10,}\s*$/;
const prefixed = /(?<![\w$])g_\w+/g;

const separator_lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter((line) => long_run.test(line) && (comment_start.test(line) || only_run.test(line)))
    .map((line) => line.trim());

const prefixed_names = (text: string): Set<string> => new Set(text.match(prefixed) ?? []);

export type StyleFindings = { names: string[]; separators: number };

export const style_findings = (file: string, previous: string | null, content: string): StyleFindings | null => {
  if (!code_extensions.has(path.extname(file).slice(1).toLowerCase())) {
    return null;
  }
  const known = prefixed_names(previous ?? "");
  const names = [...prefixed_names(content)].filter((name) => !known.has(name));
  const left = new Map<string, number>();
  for (const line of separator_lines(previous ?? "")) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }
  let separators = 0;
  for (const line of separator_lines(content)) {
    const count = left.get(line) ?? 0;
    if (count > 0) {
      left.set(line, count - 1);
    } else {
      separators += 1;
    }
  }
  return names.length || separators ? { names, separators } : null;
};

const name_list = (names: string[]): string => (names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", "));

export const style_note = (findings: StyleFindings): string => {
  const parts = [
    ...(findings.names.length ? [`names with a g_ prefix (${name_list(findings.names)})`] : []),
    ...(findings.separators ? [`${findings.separators} separator or banner line${findings.separators === 1 ? "" : "s"}`] : []),
  ];
  return `${style_marker}: you added ${parts.join(" and ")}, which the code rules turn off by default. That is fine when the user, their custom instructions, the project's instruction files or the project's existing code ask for this style. Otherwise keep in mind that it is off by default and follow the code rules, also in the file you just wrote.`;
};

const agent_notes = new Map<string, number>();

const notes_in_chat = async (chat_id: string): Promise<number> => {
  const chat = await get_chat(chat_id);
  return (chat?.messages ?? []).flatMap((message) => (message.role === "assistant" ? message.steps : [])).filter((step) => step.kind === "tool" && step.name === "write_file" && step.result_text.includes(style_marker)).length;
};

export const style_check = async (ctx: ToolContext, file: string, previous: string | null, content: string): Promise<string> => {
  const findings = style_findings(file, previous, content);
  if (!findings) {
    return "";
  }
  if (ctx.review.actor.kind === "main") {
    return (await notes_in_chat(ctx.chat_id)) < max_notes ? style_note(findings) : "";
  }
  const key = `${ctx.chat_id}:${ctx.review.actor.id}`;
  const used = agent_notes.get(key) ?? 0;
  if (used >= max_notes) {
    return "";
  }
  agent_notes.set(key, used + 1);
  return style_note(findings);
};
