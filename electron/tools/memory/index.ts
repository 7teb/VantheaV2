import type { ApprovalDecision } from "../../../shared/approval.ts";
import { canonicalize_memory } from "../../memory/canonical.ts";
import { new_memory_id } from "../../memory/records.ts";
import { confirm_memory, confirmed_memories, find_confirmed, known_memories, memory_loaded, remove_memory } from "../../memory/store.ts";
import { memory_handle, normalize_memory_key, redact_secrets } from "../../memory/text.ts";
import { path_key } from "../../storage/paths.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, type Tool, type ToolResult } from "../types.ts";

type MemoryAction = "remember" | "forget" | "list";

const result = (status: ToolResult["status"], action: MemoryAction, text: string, view_text: string): ToolResult => ({
  status,
  text,
  view: { kind: "memory", action, text: view_text },
});

const unavailable = (action: MemoryAction) =>
  result("failed", action, "The memory store failed to load at startup, so memories cannot be used right now. Tell the user to check the app log.", "");

const declined = (action: MemoryAction, text: string, decision: ApprovalDecision) =>
  result("denied", action, `The user declined.${decision.feedback ? ` User feedback: ${decision.feedback}` : ""} Do not propose this again.`, text);

const memory_enabled = (settings: { memory: { enabled: boolean } }) => settings.memory.enabled;

const remember_tool = define_tool<{ text: string }>({
  spec: {
    name: "remember",
    description:
      "Propose saving ONE short durable fact about the user to your long-term memory, so it is available in future chats. Use it when the user states a stable preference, convention, workflow rule, or fact about their stack that will still matter in unrelated future chats, or explicitly asks you to remember something. Do NOT save one-off task details, transient state, secrets, or file contents. The user is ALWAYS asked to approve the save first, so never assume it succeeded until the tool result confirms it, and do not re-propose a fact the user just declined.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The single durable fact to save, one concise self-contained sentence." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  available: memory_enabled,
  parse: (raw) => ({ text: require_string(raw, "text").trim().slice(0, 500) }),
  run: async (ctx, args) => {
    if (!memory_loaded()) {
      return unavailable("remember");
    }
    const canonical = await canonicalize_memory(args.text, known_memories(), ctx.side_model, ctx.signal);
    const project = path_key(ctx.project_root);
    const kind = canonical.kind === "project_rule" && !project ? "global_preference" : canonical.kind;
    const text = redact_secrets(canonical.text, 500);
    const decision = await ctx.approve({ kind: "memory", action: "remember", text });
    if (!decision.approved) {
      return declined("remember", text, decision);
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
    return result("done", "remember", `Saved to memory as (${memory_handle(saved.id)}) [${saved.scope}/${saved.kind}]: ${saved.text}`, saved.text);
  },
});

const forget_tool = define_tool<{ id: string }>({
  spec: {
    name: "forget",
    description:
      "Propose deleting ONE saved memory. Pass id = the memory's short handle, the characters shown in parentheses at the start of each remembered line (for example a1b2c3); the memory's exact full text also works if you do not have the handle. Call list_memories first if you are unsure which id to use. The user is ALWAYS asked to approve the deletion and is shown the memory's text, so never assume it succeeded until the tool result confirms it.",
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
    const decision = await ctx.approve({ kind: "memory", action: "forget", text: target.text });
    if (!decision.approved) {
      return declined("forget", target.text, decision);
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
