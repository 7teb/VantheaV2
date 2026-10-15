import type { SendRequest } from "../../shared/ipc/chats.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { major_wait_ms, take_agent_notes, wait_for_input } from "../agents/reports.ts";
import { roster_facts } from "../agents/roster.ts";
import { flush_chat, get_chat, set_streaming, set_summary, update_message } from "../chats/store.ts";
import { stored_context } from "../context/calibration.ts";
import { harness_facts } from "../context/facts.ts";
import { save_tool_images } from "../media/files.ts";
import { major_effort } from "../model/catalog.ts";
import { stream_round } from "../model/stream.ts";
import { cancel_chat, wait_for_decision } from "../permissions/approvals.ts";
import { human_requests_of, set_authorization } from "../permissions/context.ts";
import { chat_decisions } from "../permissions/decisions.ts";
import { instruction_snapshot } from "../permissions/instruction-files.ts";
import { main_review } from "../permissions/review-records.ts";
import { chat_written } from "../permissions/written-files.ts";
import { build_system_prompt } from "../prompts/index.ts";
import { take_main_steer } from "../questions/answers.ts";
import { get_settings } from "../settings/store.ts";
import { side_model } from "../side/model.ts";
import { reasoning_status_call } from "../side/reasoning-status.ts";
import { review_call } from "../side/review.ts";
import { describe_attachment_image } from "../side/vision.ts";
import { error_text } from "../storage/coerce.ts";
import { mcp_tools } from "../tools/mcp/tools.ts";
import { tools_for } from "../tools/registry.ts";
import { drop_untaken_steers, unregister_active, type ActiveTurn } from "./active.ts";
import { carried_todos_note } from "./carried-todos.ts";
import { build_api_messages } from "./history.ts";
import { run_compaction_turn, run_turn_loop } from "./loop.ts";
import type { CompactionHooks, TurnNote, TurnSession } from "./session.ts";
import { note_newest_user } from "./vision-notes.ts";

export type TurnPlan = {
  chat_id: string;
  message_id: string;
  model: ModelEntry;
  effort: string;
  mode: SendRequest["mode"];
  plan: boolean;
  compact_only: boolean;
  user_request: string;
  project_root: string;
};

let turn_finished: ((chat_id: string, message_id: string) => void) | null = null;

export const set_turn_finished_hook = (fn: (chat_id: string, message_id: string) => void): void => {
  turn_finished = fn;
};

const run_finished_hook = (chat_id: string, message_id: string) => {
  try {
    turn_finished?.(chat_id, message_id);
  } catch (error) {
    console.error(`[turn] turn-finished hook for chat ${chat_id} failed:`, error);
  }
};

const chat_compaction = ({ chat_id, message_id, project_root }: TurnPlan): CompactionHooks => ({
  audience: "user",
  facts: async () => {
    const chat = await get_chat(chat_id);
    const steps = (chat?.messages ?? []).flatMap((message) => (message.role === "assistant" ? message.steps : []));
    return [harness_facts(steps, chat_written(chat_id), project_root), roster_facts(chat_id, null)].filter(Boolean).join("\n\n");
  },
  save: ({ note, facts, through_round }) => set_summary(chat_id, { text: note, through_message_id: message_id, through_round, facts }),
});

export const drive = async (plan: TurnPlan, turn: ActiveTurn): Promise<void> => {
  const signal = turn.controller.signal;
  try {
    const loaded = await get_chat(plan.chat_id);
    if (!loaded) {
      throw new Error(`chat ${plan.chat_id} is no longer available`);
    }
    const settings = get_settings();
    const history = await note_newest_user(
      loaded.messages.filter((message) => message.id !== plan.message_id),
      plan.model,
      signal,
      describe_attachment_image,
      (user) => update_message(plan.chat_id, user.id, () => user),
    );
    set_authorization(plan.chat_id, history, turn.steers);
    await instruction_snapshot(plan.chat_id, plan.project_root, human_requests_of(plan.chat_id));
    const profile = plan.plan ? "plan" : "main";
    const offered = tools_for(profile, settings, plan.model, mcp_tools());
    const agent_tools = offered.some((tool) => tool.spec.name === "continue_agent");
    const system = await build_system_prompt({
      model: plan.model,
      settings,
      mode: plan.mode,
      plan: plan.plan,
      personality: settings.personality,
      project_root: plan.project_root,
      chat_id: plan.chat_id,
      user_text: plan.user_request,
      tools: offered,
      user_attachments: true,
      effort: plan.effort,
    });
    const api_messages = await build_api_messages({ system, summary: loaded.summary, messages: history, model: plan.model, agent_tools });
    const carried = offered.some((tool) => tool.spec.name === "update_todos") ? carried_todos_note(history) : null;
    let opening_notes: TurnNote[] = carried ? [carried] : [];
    const session: TurnSession = {
      chat_id: plan.chat_id,
      message_id: plan.message_id,
      user_request: plan.user_request,
      project_root: plan.project_root,
      settings,
      model: plan.model,
      effort: plan.effort,
      mode: plan.mode,
      plan: plan.plan,
      signal,
      emit: turn.emit,
      stream: stream_round,
      resolve_tools: (p) => tools_for(p, settings, plan.model, mcp_tools()),
      side_model,
      wait_decision: (call_id, request, on_hold) => wait_for_decision({ key: plan.chat_id, chat_id: plan.chat_id, call_id, request, signal, on_hold }),
      review: main_review(plan.chat_id, review_call),
      human_decisions: () => chat_decisions(plan.chat_id),
      steers: {
        next: () => turn.steers[0] ?? null,
        noted: (steer) => turn.notes.get(steer.id) ?? Promise.resolve(steer.attachments),
        take: (steer_id) => {
          take_main_steer(plan.chat_id, steer_id);
        },
      },
      take_notes: () => {
        const notes = [...opening_notes, ...take_agent_notes(plan.chat_id, agent_tools)];
        opening_notes = [];
        return notes;
      },
      idle: () => wait_for_input(plan.chat_id, plan.effort === major_effort ? major_wait_ms : 0, signal),
      store_images: save_tool_images,
      compaction: chat_compaction(plan),
      stored_context: stored_context(history, plan.model.id),
      reasoning_status: reasoning_status_call,
    };
    await (plan.compact_only ? run_compaction_turn(session, api_messages) : run_turn_loop(session, api_messages));
  } catch (error) {
    if (signal.aborted) {
      turn.emit({ type: "end", status: "stopped", error: null });
      return;
    }
    console.error(`[turn] turn ${plan.message_id} in chat ${plan.chat_id} failed to run:`, error);
    turn.emit({ type: "end", status: "failed", error: { kind: "internal", message: error_text(error) } });
  } finally {
    drop_untaken_steers(plan.chat_id, turn);
    set_streaming(plan.chat_id, false);
    unregister_active(plan.chat_id, plan.message_id);
    cancel_chat(plan.chat_id);
    try {
      await flush_chat(plan.chat_id);
    } catch (error) {
      console.error(`[turn] saving chat ${plan.chat_id} after turn ${plan.message_id} failed:`, error);
    }
    run_finished_hook(plan.chat_id, plan.message_id);
  }
};
