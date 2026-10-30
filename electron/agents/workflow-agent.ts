import type { AgentRunStatus } from "../../shared/ipc/work.ts";
import type { PromptSection } from "../prompts/sections.ts";
import { define_tool, type JsonSchema, type Tool } from "../tools/types.ts";
import type { TurnNote } from "../turn/session.ts";
import { validate_result } from "../workflows/schema.ts";
import type { AgentRecord } from "./records.ts";

export type WorkflowAgentEnd = { status: Exclude<AgentRunStatus, "running">; report: string; error: string };

export type WorkflowAgentLink = {
  run_id: string;
  workflow_name: string;
  index: number;
  role_name: string;
  instructions: string;
  schema: JsonSchema | null;
  worktree: { dir: string; branch: string; base: string } | null;
  result: { value: Record<string, unknown> } | null;
  reminder_due: boolean;
  on_end: (end: WorkflowAgentEnd) => void;
};

export const result_tool_name = "structured_result";

const removed_tools = new Set(["message_main_agent", "message_peer"]);

const profile_texts: Record<AgentRecord["profile"], string> = {
  explore: "Your profile is explore: you are read-only, and your file tools reach only your project folder.",
  worker: "Your profile is worker: you may read, edit files and run commands, under the same permission checks as the main agent. Destructive or system-changing actions outside the project that your task does not name explicitly: do not run them, report them as blockers in your result.",
};

const result_tool = (link: WorkflowAgentLink, schema: JsonSchema): Tool =>
  define_tool<Record<string, unknown>>({
    spec: {
      name: result_tool_name,
      description:
        "Return your result to the workflow script as one object that matches these parameters. The app validates it: on a mismatch you get every error and call this tool again with the corrected complete object. After a successful call, end your run with a one-line final message; the recorded object is the return value, your text is not.",
      parameters: schema,
    },
    profiles: ["explore", "worker"],
    parse: (raw) => raw,
    run: async (_ctx, args) => {
      const errors = validate_result(schema, args);
      if (errors.length) {
        return {
          status: "failed",
          text: `The result does not match the schema, nothing was recorded:\n${errors.map((error) => `- ${error}`).join("\n")}\nCall ${result_tool_name} again with the corrected complete object.`,
          view: { kind: "text", text: errors.join("\n") },
        };
      }
      link.result = { value: args };
      return { status: "done", text: "Result recorded as the return value. End your run now with a one-line final message; do not repeat the result.", view: { kind: "text", text: JSON.stringify(args).slice(0, 2000) } };
    },
  });

export const workflow_agent_tools = (tools: Tool[], link: WorkflowAgentLink): Tool[] => {
  const kept = tools.filter((tool) => !removed_tools.has(tool.spec.name) && tool.spec.name !== result_tool_name);
  return link.schema ? [...kept, result_tool(link, link.schema)] : kept;
};

const worktree_text = (link: WorkflowAgentLink): string[] =>
  link.worktree
    ? [
        `You work in your own git worktree ${link.worktree.dir} on the branch ${link.worktree.branch}, created from commit ${link.worktree.base}. It is your project folder: read, edit and test there. Other agents of the workflow work in their own folders at the same time. Commit your finished changes on your branch when the task asks for a commit; uncommitted changes stay in the worktree. When you leave the worktree unchanged it is removed after your run.`,
      ]
    : [];

const result_text = (link: WorkflowAgentLink): string =>
  link.schema
    ? `Return your result by calling ${result_tool_name} with an object that matches its parameters. The app validates it and tells you exactly what to fix on a mismatch. Your run cannot end before a valid result is recorded. After the successful call, end with a one-line final message.`
    : "Your final message is the return value: it is handed to the script as a string. Make it the complete result in the form the task asks for, and nothing else.";

export const workflow_role_section = (agent: AgentRecord, link: WorkflowAgentLink): PromptSection => ({
  title: "workflow_agent_role",
  body: [
    `You are the sub-agent "${agent.name}" (id ${agent.agent_id}), started by the workflow script "${link.workflow_name}" (run ${link.run_id}, call ${link.index + 1}) of the main VantheaX agent. A script runs many agents like you and combines their results in code. There is no interactive user in this conversation, and this block overrides any guidance above that conflicts with it.`,
    "Do only the task in the latest message. Do not ask questions or wait for input: find missing details with your tools, and if you are genuinely blocked, put the exact blocker into your result. Do not broaden or replace the task. If the evidence shows the named target is wrong, change nothing there and report the evidence and the right place instead.",
    profile_texts[agent.profile],
    ...(link.instructions ? [`Your role is ${link.role_name}. Its instructions:\n${link.instructions}`] : []),
    ...worktree_text(link),
    "Your final message is the return value of agent() in the script, not a message to a person. Code reads it. Return raw data: no greeting, no recap of the task, no closing remark, no offer of further help. Keep what you observed apart from what you inferred, and mark inferences as such. If you found nothing, say so plainly and say what you covered.",
    result_text(link),
    "Write no text between tool calls. Nobody reads your transcript while you work; call your next tool without announcing or summarizing it.",
  ].join("\n\n"),
});

export const result_reminder = (link: WorkflowAgentLink): TurnNote[] => {
  if (!link.reminder_due) {
    return [];
  }
  link.reminder_due = false;
  return [
    {
      kind: "notice",
      notice: "update_reminder",
      text: "",
      content: `[Internal app event, not a new task. Your run is not finished: the script needs your result, and no valid result has been recorded yet. Call ${result_tool_name} now with the complete object that matches its parameters. Do not answer this note in text.]`,
    },
  ];
};

export const wants_result = (link: WorkflowAgentLink): boolean => link.schema !== null && link.result === null;
