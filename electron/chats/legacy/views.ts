import type { Todo } from "../../../shared/chat.ts";
import type { DiffLine, OutlineSymbol, ToolView } from "../../../shared/tool-view.ts";
import { as_array, as_number, as_record, as_string, is_record } from "../../storage/coerce.ts";

type Raw = Record<string, unknown>;

export type ViewContext = { project_path: string; image: (name: string) => string };

const max_diff_lines = 2000;
const max_output_chars = 20_000;
const outline_pattern = /^(\d+):\s*(?:export\s+)?(?:async\s+)?(function|class|const|let|var|auto|public|private|protected|static|def)\s+([A-Za-z0-9_:<>]+)/;
const memory_actions = { remember: "remember", forget: "forget", list_memories: "list" } as const;

export const shorten = (text: string, max = 300): string => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

const tail = (text: string, max: number): string => (text.length > max ? text.slice(-max) : text);

const strings = (value: unknown): string[] => as_array(value).filter((item): item is string => typeof item === "string");

const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

const line_number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const diff_lines = (diff: Raw): DiffLine[] => {
  const out: DiffLine[] = [];
  for (const hunk of as_array(diff.hunks)) {
    if (out.length >= max_diff_lines) {
      break;
    }
    if (out.length) {
      out.push({ kind: "gap", text: "", old_line: null, new_line: null });
    }
    for (const entry of as_array(hunk)) {
      const row = as_record(entry);
      const text = as_string(row.text);
      if (row.t === "add") {
        out.push({ kind: "add", text, old_line: null, new_line: line_number(row.b) });
        continue;
      }
      if (row.t === "del") {
        out.push({ kind: "remove", text, old_line: line_number(row.a), new_line: null });
        continue;
      }
      out.push({ kind: "context", text, old_line: line_number(row.a), new_line: line_number(row.b) });
    }
  }
  return out.slice(0, max_diff_lines);
};

const outline_symbols = (lines: unknown): OutlineSymbol[] =>
  strings(lines).flatMap((line) => {
    const match = outline_pattern.exec(line);
    return match ? [{ kind: match[2] ?? "", name: match[3] ?? "", line: Number(match[1]), depth: 0 }] : [];
  });

const plan_text = (plan: Raw): string => {
  const sections: string[] = [];
  const summary = as_string(plan.summary).trim();
  if (summary) {
    sections.push(summary);
  }
  const list = (title: string, value: unknown) => {
    const items = strings(value);
    if (items.length) {
      sections.push(`${title}:\n${items.map((item) => `- ${item}`).join("\n")}`);
    }
  };
  list("Key changes", plan.keyChanges);
  list("Files to change", plan.filesToChange);
  list("Test plan", plan.testPlan);
  list("Assumptions", plan.assumptions);
  const risk = as_string(plan.riskLevel);
  if (risk) {
    sections.push(`Risk: ${risk}`);
  }
  return sections.join("\n\n");
};

const todos = (value: unknown): Todo[] =>
  as_array(value).map((entry, position) => {
    const raw = as_record(entry);
    return { id: String(position + 1), text: as_string(raw.text), status: raw.done === true ? "done" : "pending" };
  });

const mcp_view = (name: string, result: Raw): ToolView => {
  const [server = "", ...tool] = name.slice("mcp__".length).split("__");
  return {
    kind: "mcp",
    server: as_string(result.server, as_string(result.mcpServer, server)),
    tool: as_string(result.tool, as_string(result.mcpTool, tool.join("__"))),
    text: tail(as_string(result.content), max_output_chars),
    is_error: result.isError === true,
  };
};

const browser_view = (name: string, args: Raw, result: Raw): ToolView => ({
  kind: "browser",
  action: name.slice("browser_".length),
  url: as_string(result.url, as_string(args.url)),
  title: as_string(result.title),
  detail: [result.action, args.action, args.ref, args.key, args.direction].map((value) => as_string(value)).find(Boolean) ?? "",
});

const file_views = (name: string, args: Raw, result: Raw, ctx: ViewContext): ToolView | null => {
  switch (name) {
    case "list_files": {
      if (!Array.isArray(result.files)) {
        return null;
      }
      const files = result.files.map((entry) => (typeof entry === "string" ? entry : as_string(as_record(entry).path))).filter(Boolean);
      return { kind: "files", root: ctx.project_path, files: files.slice(0, 1000), directories: as_array(result.directories).length, truncated: files.length > 1000 };
    }
    case "read_file":
      return typeof result.content === "string"
        ? {
            kind: "read",
            path: as_string(result.path, as_string(args.path)),
            start_line: as_number(result.startLine, 1),
            end_line: as_number(result.endLine, 0),
            total_lines: as_number(result.totalLines, 0),
            truncated: result.tooLarge === true,
          }
        : null;
    case "grep_files": {
      if (!Array.isArray(result.matches)) {
        return null;
      }
      const matches = result.matches.slice(0, 200).map((entry) => {
        const raw = as_record(entry);
        return { path: as_string(raw.path), line: as_number(raw.line, 0), text: as_string(raw.text) };
      });
      return { kind: "grep", query: as_string(result.query, as_string(args.query)), matches, total: as_number(result.count, matches.length), truncated: result.capped === true };
    }
    case "get_file_outline":
      return Array.isArray(result.outline) ? { kind: "outline", path: as_string(result.path, as_string(args.path)), symbols: outline_symbols(result.outline) } : null;
    case "write_file":
    case "replace_in_file": {
      if (result.written !== true) {
        return null;
      }
      const diff = as_record(result.diff);
      return {
        kind: "edit",
        path: as_string(result.path, as_string(args.path)),
        created: result.created === true,
        added: as_number(diff.added, 0),
        removed: as_number(diff.removed, 0),
        diff: diff_lines(diff),
      };
    }
    case "run_command":
      if (result.exitCode === undefined && result.stdout === undefined && result.stderr === undefined) {
        return null;
      }
      return {
        kind: "command",
        command: as_string(result.command, as_string(args.command)),
        cwd: as_string(result.cwd, as_string(args.cwd, ".")),
        exit_code: typeof result.exitCode === "number" ? result.exitCode : null,
        output: tail(joined(as_string(result.stdout), as_string(result.stderr)), max_output_chars),
        timed_out: result.timedOut === true,
        duration_ms: as_number(result.durationMs, 0),
      };
  }
  return null;
};

const work_views = (name: string, args: Raw, result: Raw, ctx: ViewContext): ToolView | null => {
  switch (name) {
    case "start_background_task":
      return result.started === true
        ? { kind: "background", task_id: as_string(result.id), command: as_string(args.command), status: as_string(result.status, "running"), output_tail: "" }
        : null;
    case "get_background_task":
      return result.backgroundTask === true
        ? {
            kind: "background",
            task_id: as_string(result.id),
            command: as_string(result.command),
            status: as_string(result.status),
            output_tail: tail(joined(as_string(result.stdoutTail), as_string(result.stderrTail)), 4000),
          }
        : null;
    case "deploy_agent":
    case "continue_agent":
      return result.agent === true
        ? {
            kind: "agent",
            agent_id: as_string(result.agentId),
            run_id: as_string(result.runId),
            name: as_string(result.name, as_string(args.name)),
            status: as_string(result.status),
            report: as_string(result.report),
          }
        : null;
    case "get_agent_status":
      return result.agentStatus === true
        ? {
            kind: "agent",
            agent_id: as_string(result.agentId),
            run_id: "",
            name: as_string(result.name),
            status: as_string(result.status),
            report: as_string(result.report) || as_string(result.lastActivity),
          }
        : null;
    case "update_todos":
      return Array.isArray(result.todos) ? { kind: "todos", todos: todos(result.todos) } : null;
    case "present_plan":
      return is_record(result.plan) ? { kind: "plan", text: plan_text(result.plan) } : null;
    case "web_search":
      return {
        kind: "web_search",
        query: as_string(result.query, as_string(args.query)),
        depth: result.depth === "advanced" ? "advanced" : "basic",
        answer: as_string(result.answer),
        sources: as_array(result.sources)
          .map((entry) => {
            const raw = as_record(entry);
            return { title: as_string(raw.title), url: as_string(raw.url), snippet: "" };
          })
          .filter((source) => source.url),
      };
    case "generate_image": {
      const names = as_array(result.images).map((entry) => as_string(as_record(entry).name)).filter(Boolean);
      return names.length
        ? { kind: "image", prompt: as_string(result.prompt, as_string(args.prompt)), images: names.map((image) => ({ id: ctx.image(image), width: null, height: null })) }
        : null;
    }
    case "remember":
    case "forget":
    case "list_memories": {
      if (result.memory !== true) {
        return null;
      }
      const listed = as_array(result.memories).map((entry) => as_string(as_record(entry).text));
      return { kind: "memory", action: memory_actions[name], text: as_string(result.text) || listed.join("\n") };
    }
    case "read_skill":
      return result.skill === true ? { kind: "skill", action: "read", name: as_string(result.name, as_string(args.name)) } : null;
    case "install_skill":
      return result.skillInstall === true ? { kind: "skill", action: "install", name: as_string(result.name) } : null;
  }
  return null;
};

export const legacy_view = (name: string, args: Raw, result: Raw, ctx: ViewContext): ToolView | null => {
  if (name.startsWith("mcp__")) {
    return mcp_view(name, result);
  }
  if (name.startsWith("browser_")) {
    return browser_view(name, args, result);
  }
  return file_views(name, args, result, ctx) ?? work_views(name, args, result, ctx);
};
