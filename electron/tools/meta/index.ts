import type { Todo } from "../../../shared/chat.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type ContextReading, type Tool } from "../types.ts";
import { ask_user_tool } from "./ask-user.ts";

const max_todos = 20;

const max_todo_chars = 200;

const todo_statuses: readonly Todo["status"][] = ["pending", "in_progress", "done"];

const todo_marks: Record<Todo["status"], string> = { pending: "[ ]", in_progress: "[~]", done: "[x]" };

const parse_todo = (value: unknown, index: number): Todo => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolArgumentError(`todos[${index}] must be an object with text and status`);
  }
  const raw = value as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    throw new ToolArgumentError(`todos[${index}].text must be a non-empty string`);
  }
  const status = todo_statuses.find((entry) => entry === raw.status);
  if (!status) {
    throw new ToolArgumentError(`todos[${index}].status must be one of ${todo_statuses.join(", ")}`);
  }
  return { id: `todo-${index + 1}`, text: text.slice(0, max_todo_chars), status };
};

const todos_text = (todos: Todo[]): string => {
  const list = `Todos updated:\n${todos.map((todo) => `${todo_marks[todo.status]} ${todo.text}`).join("\n")}`;
  const open = todos.filter((todo) => todo.status !== "done").length;
  return open === 0 ? list : `${list}\n${open} of ${todos.length} still open. When the step in_progress is finished, mark it done right away, together with the first tool call of the next step. Before your final answer, call update_todos again: finished items done, unfinished items pending.`;
};

const parse_todos = (raw: Record<string, unknown>): Todo[] => {
  if (!Array.isArray(raw.todos)) {
    throw new ToolArgumentError("todos must be a list");
  }
  if (raw.todos.length > max_todos) {
    throw new ToolArgumentError(`todos has ${raw.todos.length} entries; at most ${max_todos} are allowed, merge smaller steps`);
  }
  return raw.todos.map(parse_todo);
};

export const update_todos_tool = define_tool<Todo[]>({
  spec: {
    name: "update_todos",
    description: `Show the user the step list for the current task. It stays visible above the input box until every item is done or the list is cleared. Call it before the first edit with the first step in_progress and the rest pending. Then keep it live: the moment a step is finished, call it with that step done and the next one in_progress, in the same response as the first tool call of the next step. Never finish several steps and mark them done together in one later call. Before your final answer, call it once more so finished items are done and unfinished ones are pending; never end a turn with an item in_progress. Pass the whole list each time, at most ${max_todos} steps.`,
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, status: { type: "string", enum: [...todo_statuses] } },
            required: ["text", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "worker"],
  parse: parse_todos,
  run: async (...[, todos]) => ({
    status: "done",
    text: todos.length ? todos_text(todos) : "Todo list cleared.",
    view: { kind: "todos", todos },
  }),
});

export const present_plan_tool = define_tool<{ plan: string }>({
  spec: {
    name: "present_plan",
    description:
      "Present the implementation plan to the user for approval once the investigation is done. plan is Markdown: the goal, the concrete changes per file, assumptions, and how the result will be verified.",
    parameters: {
      type: "object",
      properties: { plan: { type: "string" } },
      required: ["plan"],
      additionalProperties: false,
    },
  },
  profiles: ["plan"],
  parse: (raw) => ({ plan: require_string(raw, "plan").trim() }),
  run: async (...[, args]) => ({
    status: "done",
    text: "The plan is shown to the user, who accepts it or asks for changes. End the turn now and do not start implementing.",
    view: { kind: "plan", text: args.plan },
  }),
});

const two = (value: number) => String(value).padStart(2, "0");

export const local_iso = (now: Date): string => {
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const zone = `${sign}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  return `${date}T${time}${zone}`;
};

export const datetime_tool = define_tool<Record<string, never>>({
  spec: {
    name: "datetime",
    description: "Get the current local date and time on the user's machine, with UTC offset and time zone name.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan", "explore", "worker"],
  concurrent: true,
  parse: () => ({}),
  run: async () => {
    const text = `${local_iso(new Date())} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
    return { status: "done", text, view: { kind: "text", text } };
  },
});

const token_count = (tokens: number) => `${tokens.toLocaleString("en-US")} tokens`;

const share = (tokens: number, limit: number) => `${Math.round((tokens / limit) * 100)}%`;

export const context_text = ({ used, limit, compact_at }: ContextReading): string => {
  if (compact_at === null) {
    return `In use: ${token_count(used)}. The model's context window is unknown, so the app does not compact this conversation automatically.`;
  }
  const facts = [`Context window: ${token_count(limit)}.`, `In use: ${token_count(used)} (${share(used, limit)}).`];
  if (used >= compact_at) {
    return [...facts, `Automatic compaction is due: the app compacts the conversation before your next model call (threshold ${token_count(compact_at)}, ${share(compact_at, limit)}).`].join(" ");
  }
  return [...facts, `Automatic compaction runs before the next model call once the context reaches ${token_count(compact_at)} (${share(compact_at, limit)}), ${token_count(compact_at - used)} from now.`].join(" ");
};

export const context_status_tool = define_tool<Record<string, never>>({
  spec: {
    name: "context_status",
    description:
      "Get your context window size, how many tokens this conversation uses right now (including your current response) and at which size the app compacts it automatically. Use it before a large read or a long run of tool calls when you need to know how much room is left.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan", "explore", "worker"],
  concurrent: true,
  parse: () => ({}),
  run: async (ctx) => {
    const text = context_text(ctx.context());
    return { status: "done", text, view: { kind: "text", text } };
  },
});

export const meta_tools: Tool[] = [update_todos_tool, present_plan_tool, datetime_tool, context_status_tool, ask_user_tool];
