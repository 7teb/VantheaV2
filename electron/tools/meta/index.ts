import type { Todo } from "../../../shared/chat.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type Tool } from "../types.ts";

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
    description: `Show the user the step list for the current task. Call it before the first edit with every step pending, then whenever a step starts (in_progress) or finishes (done). Pass the whole list each time, at most ${max_todos} steps.`,
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
    text: todos.length ? `Todos updated:\n${todos.map((todo) => `${todo_marks[todo.status]} ${todo.text}`).join("\n")}` : "Todo list cleared.",
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
  parse: () => ({}),
  run: async () => {
    const text = `${local_iso(new Date())} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
    return { status: "done", text, view: { kind: "text", text } };
  },
});

export const meta_tools: Tool[] = [update_todos_tool, present_plan_tool, datetime_tool];
