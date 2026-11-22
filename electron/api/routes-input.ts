import { parse_approval_id } from "../../shared/api/approval-id.ts";
import type { RouteId } from "../../shared/api/routes.ts";
import type { ApprovalDecision, GrantScope } from "../../shared/approval.ts";
import { message_limits, type TurnStarted } from "../../shared/ipc/chats.ts";
import { question_limits } from "../../shared/ipc/questions.ts";
import { open_questions, type QuestionAnswer } from "../../shared/questions.ts";
import { is_record } from "../storage/coerce.ts";
import { empty_reply, invalid, json_reply, optional_choice, optional_list, optional_text, read_json, RequestError, required_flag, required_text } from "./body.ts";
import { resolve_run_options } from "./options.ts";
import type { ApiContext, Handler } from "./router.ts";
import { require_session } from "./routes-sessions.ts";
import { admit_with_options, session_approvals, tracked_run } from "./runs.ts";

const grants: readonly Exclude<GrantScope, "full_window">[] = ["once", "prefix", "chat", "session"];

const pending_approval = async (context: ApiContext, session_id: string, approval_id: string) => {
  const parsed = parse_approval_id(approval_id);
  const pending = await session_approvals(context, session_id);
  if (!parsed || !pending.some((entry) => entry.approval_id === approval_id)) {
    throw new RequestError(404, "not_found", `approval ${approval_id} is not pending in session ${session_id}`);
  }
  return parsed;
};

const parse_decision = (body: Record<string, unknown>): ApprovalDecision => ({
  approved: required_flag(body, "approved"),
  grant: optional_choice(body, "grant", grants) ?? "once",
  feedback: optional_text(body, "feedback", message_limits.feedback) ?? "",
});

const parse_answers = (body: Record<string, unknown>): QuestionAnswer[] => {
  const value = body.answers;
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > question_limits.entries) {
    throw invalid(`answers must be a list of at most ${question_limits.entries} entries`);
  }
  const answers = value.map((entry) => {
    if (!is_record(entry)) {
      throw invalid("every answer must be an object with id and answer");
    }
    return { id: required_text(entry, "id", 300), answer: required_text(entry, "answer", question_limits.answer, 0) };
  });
  if (new Set(answers.map((entry) => entry.id)).size !== answers.length) {
    throw invalid("answers must not repeat a question id");
  }
  return answers;
};

const answer_turn = async (context: ApiContext, session_id: string): Promise<TurnStarted | null> => {
  const message_id = context.active_message(session_id);
  if (!message_id || tracked_run(message_id)) {
    return null;
  }
  const chat = await context.invoke("chats:get", session_id);
  const at = chat?.messages.findIndex((message) => message.id === message_id) ?? -1;
  const user = at > 0 ? chat?.messages[at - 1] : undefined;
  if (user?.role !== "user") {
    throw new RequestError(404, "not_found", `session ${session_id} no longer holds the turn ${message_id} that the answer started`);
  }
  return { user_message_id: user.id, message_id };
};

export const input_routes = {
  "approvals.list": async ({ context, params }) => {
    require_session(context, params.id);
    return json_reply(await session_approvals(context, params.id));
  },
  "approvals.reply": async ({ context, request, params }) => {
    require_session(context, params.id);
    const decision = parse_decision(await read_json(request));
    const target = await pending_approval(context, params.id, params.approval_id);
    if (target.source === "main") {
      await context.invoke("turn:approve", params.id, target.call_id, decision);
    } else {
      await context.invoke("agents:approve", target.agent_id, target.run_id, target.call_id, decision);
    }
    return empty_reply(204);
  },
  "approvals.hold": async ({ context, params }) => {
    require_session(context, params.id);
    const target = await pending_approval(context, params.id, params.approval_id);
    if (target.source === "main") {
      await context.invoke("turn:hold_approval", params.id, target.call_id);
    } else {
      await context.invoke("agents:hold_approval", target.agent_id, target.run_id, target.call_id);
    }
    return empty_reply(204);
  },
  "questions.list": async ({ context, params }) => {
    require_session(context, params.id);
    const chat = await context.invoke("chats:get", params.id);
    if (!chat) {
      throw new RequestError(404, "not_found", `session ${params.id} not found`);
    }
    return json_reply(open_questions(chat.messages, chat.questions));
  },
  "questions.reply": async ({ context, request, params }) => {
    require_session(context, params.id);
    const body = await read_json(request);
    const answers = parse_answers(body);
    const dismiss = optional_list(body, "dismiss", question_limits.entries, 300) ?? [];
    if (!answers.length && !dismiss.length) {
      throw invalid("a questions reply needs answers or dismiss");
    }
    if (dismiss.length) {
      await context.invoke("questions:dismiss", params.id, dismiss);
    }
    if (!answers.length) {
      return empty_reply(204);
    }
    await context.ended_turn_settled(params.id);
    if (context.is_active(params.id)) {
      await context.invoke("questions:answer", params.id, answers);
      return empty_reply(204);
    }
    const options = context.run_options(params.id) ?? (await resolve_run_options(context, params.id, {}));
    const started = await admit_with_options(context, params.id, options, async () => {
      await context.invoke("questions:answer", params.id, answers);
      return context.is_active(params.id) ? answer_turn(context, params.id) : null;
    });
    return started ? json_reply(started, 202) : empty_reply(204);
  },
} satisfies Partial<Record<RouteId, Handler>>;
