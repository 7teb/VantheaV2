import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest, HumanDecision } from "../../shared/approval.ts";
import type { Message, ToolStep } from "../../shared/chat.ts";
import { get_chat, update_message } from "../chats/store.ts";
import { error_text } from "../storage/coerce.ts";

const max_subject_chars = 2000;
const shown_decisions = 12;
const shown_subject_chars = 500;

export const command_tools = ["run_command", "start_background_task"];

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

const request_subject = (request: ApprovalRequest): { tool: string; subject: string; cwd: string; reason: string } => {
  switch (request.kind) {
    case "command":
      return { tool: request.background ? "start_background_task" : "run_command", subject: request.command, cwd: request.cwd, reason: request.overseer?.reason ?? "" };
    case "mcp":
      return { tool: `mcp:${request.server}/${request.tool}`, subject: request.args_preview, cwd: "", reason: request.reason ?? "" };
    case "write":
      return { tool: "write_file", subject: request.path, cwd: "", reason: "" };
    case "mcp_server":
      return { tool: "add_mcp_server", subject: `${request.name}: ${[request.command, ...request.args].join(" ")}`, cwd: request.cwd, reason: "" };
    case "skill_install":
      return { tool: "install_skill", subject: request.name, cwd: "", reason: "" };
    case "memory":
      return { tool: `memory_${request.action}`, subject: request.text, cwd: "", reason: "" };
    case "browser_vision":
      return { tool: "browser_vision", subject: request.url, cwd: "", reason: "" };
  }
};

export const human_decision = (request: ApprovalRequest, decision: ApprovalDecision, actor: string, context_hash: string): HumanDecision => {
  const { tool, subject, cwd, reason } = request_subject(request);
  const prefix = request.kind === "command" && decision.approved && decision.grant === "prefix" ? request.grant_prefix : null;
  return {
    id: randomUUID(),
    at: Date.now(),
    actor,
    tool,
    subject: clip(subject, max_subject_chars),
    cwd,
    approved: decision.approved,
    grant: decision.grant,
    feedback: decision.feedback,
    reason,
    context_hash,
    ...(prefix ? { grant_prefix: prefix } : {}),
    ...(request.kind === "command" && request.source_hash ? { source_hash: request.source_hash } : {}),
  };
};

const legacy_denial = (message_id: string, step: ToolStep): HumanDecision | null => {
  if (step.status !== "denied" || !command_tools.includes(step.name) || !step.result_text.startsWith("The user denied this command.")) {
    return null;
  }
  const command = typeof step.args.command === "string" ? step.args.command : "";
  if (!command) {
    return null;
  }
  return {
    id: `legacy:${message_id}:${step.call_id}`,
    at: step.ended_at ?? step.started_at ?? 0,
    actor: "main",
    tool: step.name,
    subject: clip(command, max_subject_chars),
    cwd: typeof step.args.cwd === "string" ? step.args.cwd : ".",
    approved: false,
    grant: "once",
    feedback: /User feedback: ([\s\S]*)$/.exec(step.result_text)?.[1]?.trim() ?? "",
    reason: "",
  };
};

const step_decisions = (message_id: string, step: ToolStep): HumanDecision[] => {
  const legacy = step.decisions?.length ? null : legacy_denial(message_id, step);
  return [...(step.decisions ?? []), ...(legacy ? [legacy] : [])];
};

export const decisions_in = (messages: Message[]): HumanDecision[] => {
  const found: HumanDecision[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const step of message.steps) {
      if (step.kind === "tool") {
        found.push(...step_decisions(message.id, step));
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
};

export const merge_decisions = (...lists: HumanDecision[][]): HumanDecision[] => {
  const by_id = new Map<string, HumanDecision>();
  for (const entry of lists.flat()) {
    by_id.set(entry.id, entry);
  }
  return [...by_id.values()].sort((a, b) => a.at - b.at);
};

export const chat_decisions = async (chat_id: string): Promise<HumanDecision[]> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    console.warn(`[permissions] chat ${chat_id} is not available, reviewing without its earlier human decisions`);
    return [];
  }
  return decisions_in(chat.messages);
};

export const mirror_decision = async (chat_id: string, message_id: string, call_id: string, decision: HumanDecision): Promise<void> => {
  try {
    const chat = await get_chat(chat_id);
    const parent = chat?.messages.find((message) => message.id === message_id);
    const step = parent?.role === "assistant" ? parent.steps.find((entry) => entry.kind === "tool" && entry.call_id === call_id) : undefined;
    if (!step) {
      console.warn(`[permissions] deploy step ${call_id} of chat ${chat_id} is gone, decision ${decision.id} of ${decision.actor} is kept in the agent transcript only`);
      return;
    }
    update_message(chat_id, message_id, (message) =>
      message.role !== "assistant"
        ? message
        : {
            ...message,
            steps: message.steps.map((entry) =>
              entry.kind === "tool" && entry.call_id === call_id ? { ...entry, decisions: [...(entry.decisions ?? []).filter((item) => item.id !== decision.id), decision] } : entry,
            ),
          },
    );
  } catch (error) {
    console.error(`[permissions] mirroring decision ${decision.id} of ${decision.actor} into chat ${chat_id} failed: ${error_text(error)}`);
  }
};

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export const last_decision_for = (decisions: HumanDecision[], tools: string[], subject: string): HumanDecision | null => {
  const wanted = normalize(clip(subject, max_subject_chars));
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const entry = decisions[index];
    if (entry && tools.includes(entry.tool) && normalize(entry.subject) === wanted) {
      return entry;
    }
  }
  return null;
};

export const approved_with_source = (decisions: HumanDecision[], command: string, source_hash: string): boolean => {
  const last = last_decision_for(decisions, command_tools, command);
  return Boolean(last?.approved && last.source_hash === source_hash);
};

export const prefix_grants = (decisions: HumanDecision[]): { prefix: string; example: string }[] =>
  decisions.flatMap((entry) => (entry.approved && entry.grant === "prefix" && entry.grant_prefix && command_tools.includes(entry.tool) ? [{ prefix: entry.grant_prefix, example: entry.subject }] : []));

export const denial_reason = (denial: HumanDecision): string =>
  `You denied this exact action earlier in this chat${denial.feedback ? ` ("${clip(denial.feedback, 300)}")` : ""}, so it does not run automatically again.`;

export const repeated_denial_text = (denial: HumanDecision): string =>
  `The user already denied this exact action and has not said anything new since${denial.feedback ? `. Their feedback: ${clip(denial.feedback, 300)}` : ""}. Do not retry it or reach the same effect another way; continue differently or ask the user in your reply.`;

export const decisions_text = (decisions: HumanDecision[]): string => {
  const recent = decisions.slice(-shown_decisions);
  if (!recent.length) {
    return "";
  }
  const omitted = decisions.length - recent.length;
  const lines = recent.map((entry) =>
    JSON.stringify({
      approved: entry.approved,
      by: entry.actor,
      tool: entry.tool,
      action: clip(entry.subject, shown_subject_chars),
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
      ...(entry.feedback ? { feedback: clip(entry.feedback, shown_subject_chars) } : {}),
    }),
  );
  return (omitted > 0 ? `(${omitted} older decisions omitted)\n` : "") + lines.join("\n");
};
