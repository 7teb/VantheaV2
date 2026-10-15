import type { ApprovalDecision } from "../../../shared/approval.ts";
import type { ReviewNote } from "../../../shared/review.ts";
import { canonicalize_memory } from "../../memory/canonical.ts";
import { new_memory_id } from "../../memory/records.ts";
import { confirm_memory, confirmed_memories, find_confirmed, known_memories, memory_loaded, remove_memory } from "../../memory/store.ts";
import { memory_handle, memory_text_chars, normalize_memory_key, redact_secrets } from "../../memory/text.ts";
import { path_key } from "../../storage/paths.ts";
import { require_string } from "../browser/common.ts";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { note_reason, unanswered_text } from "../../permissions/verdict-text.ts";
import { define_tool, ToolArgumentError, type Tool, type ToolContext, type ToolResult } from "../types.ts";

type MemoryAction = "remember" | "forget" | "list";

const result = (status: ToolResult["status"], action: MemoryAction, text: string, view_text: string): ToolResult => ({
  status,
  text,
  view: { kind: "memory", action, text: view_text },
});

const unavailable = (action: MemoryAction) =>
  result("failed", action, "The memory store failed to load at startup, so memories cannot be used right now. Tell the user to check the app log.", "");

const declined = (action: MemoryAction, text: string, decision: ApprovalDecision, note: ReviewNote | null) =>
  result("denied", action, decision.expired ? unanswered_text("tool call", note_reason(note)) : `The user declined.${decision.feedback ? ` User feedback: ${decision.feedback}` : ""} Do not propose this again.`, text);

const memory_enabled = (settings: { memory: { enabled: boolean } }) => settings.memory.enabled;

const refused = async (ctx: ToolContext, action: "remember" | "forget", text: string): Promise<ToolResult | null> => {
  const gate = await tool_gate(ctx, `memory_${action}`, text);
  if (gate.kind === "run") {
    return null;
  }
  if (gate.kind === "denied") {
    return result("denied", action, gate.text, text);
  }
  const decision = await ctx.approve({ kind: "memory", action, text, ...(gate.note ? { review: gate.note } : {}) });
  return decision.approved ? null : declined(action, text, decision, gate.note);
};

const remember_tool = define_tool<{ text: string }>({
  spec: {
    name: "remember",
    description:
      "Propose saving ONE short durable fact about the user to your long-term memory, so it is available in future chats. Use it when the user states a stable preference, convention, workflow rule, or fact about their stack that will still matter in unrelated future chats, or explicitly asks you to remember something. Do NOT save one-off task details, transient state, secrets, or file contents. The automatic review checks the save and may ask the user (in ask mode the user always approves it), so never assume it succeeded until the tool result confirms it, and do not re-propose a fact that was declined or denied.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The single durable fact to save, one concise self-contained sentence." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  available: memory_enabled,
  parse: (raw) => {
    const text = require_string(raw, "text").trim();
    if (text.length > memory_text_chars) {
      throw new ToolArgumentError(`text is ${text.length} characters, over the ${memory_text_chars}-character limit for one memory. Nothing was saved. Shorten the fact and call remember again.`);
    }
    return { text };
  },
  run: async (ctx, args) => {
    if (!memory_loaded()) {
      return unavailable("remember");
    }
    const canonical = await canonicalize_memory(args.text, known_memories(), ctx.side_model, ctx.signal);
    const project = path_key(ctx.project_root);
    const kind = canonical.kind === "project_rule" && !project ? "global_preference" : canonical.kind;
    const text = redact_secrets(canonical.text, memory_text_chars);
    const stop = await refused(ctx, "remember", text);
    if (stop) {
      return stop;
    }
    const now = new Date().toISOString();
    const saved = await confirm_memory({
      id: new_memory_id(),
      key: normalize_memory_key(canonical.key, kind, text),
      kind,
      scope: kind === "project_rule" ? "project" : "global",
      project_path: kind === "project_rule" ? project : "",
      text,
      evidence: args.text,
      confidence: 1,
      status: "confirmed",
      source_chat_id: ctx.chat_id,
      source_message_id: ctx.turn_id,
      created_at: now,
      updated_at: now,
    });
    const saved_line = `Saved to memory as (${memory_handle(saved.id)}) [${saved.scope}/${saved.kind}]: ${saved.text}`;
    const fallback = canonical.failure ? `\nThe memory model could not classify this fact (${canonical.failure}), so it was saved as written, as a global preference without a canonical key.` : "";
    return result("done", "remember", `${saved_line}${fallback}`, saved.text);
  },
});

const forget_tool = define_tool<{ id: string }>({
  spec: {
    name: "forget",
    description:
      "Propose deleting ONE saved memory. Pass id = the memory's short handle, the characters shown in parentheses at the start of each remembered line (for example a1b2c3); the memory's exact full text also works if you do not have the handle. Call list_memories first if you are unsure which id to use. The automatic review checks the deletion and may ask the user (in ask mode the user always approves it), so never assume it succeeded until the tool result confirms it.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The memory's handle from the parentheses (for example a1b2c3), or its exact text." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  available: memory_enabled,
  parse: (raw) => ({ id: require_string(raw, "id").trim() }),
  run: async (ctx, args) => {
    if (!memory_loaded()) {
      return unavailable("forget");
    }
    const target = find_confirmed(args.id);
    if (!target) {
      return result("failed", "forget", `No memory matches "${args.id.slice(0, 120)}". Call list_memories to see every memory with its id.`, "");
    }
    const stop = await refused(ctx, "forget", target.text);
    if (stop) {
      return stop;
    }
    if (!(await remove_memory(target.id))) {
      return result("failed", "forget", "That memory no longer exists, nothing was deleted.", target.text);
    }
    return result("done", "forget", `Deleted the memory (${memory_handle(target.id)}): ${target.text}`, target.text);
  },
});

const list_memories_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_memories",
    description:
      "List every saved long-term memory with its id, the short handle forget takes. Read-only, runs without approval. Call it before forget to pick the right memory, or when the user asks what you remember about them.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan"],
  available: memory_enabled,
  parse: () => ({}),
  run: async () => {
    if (!memory_loaded()) {
      return unavailable("list");
    }
    const lines = confirmed_memories().map((entry) => `(${memory_handle(entry.id)}) [${entry.scope}/${entry.kind}] ${entry.text}`);
    if (!lines.length) {
      return result("done", "list", "No memories are saved yet.", "");
    }
    return result("done", "list", `${lines.length} saved memories:\n${lines.join("\n")}`, lines.join("\n"));
  },
});

export const memory_tools: Tool[] = [remember_tool, forget_tool, list_memories_tool];
