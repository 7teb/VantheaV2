import { randomUUID } from "node:crypto";
import type { PromptStarted, WaitUntil } from "../../shared/api/contract.ts";
import type { RouteId } from "../../shared/api/routes.ts";
import { message_limits, type SendRequest, type TurnStarted } from "../../shared/ipc/chats.ts";
import { attachment_limits } from "../../shared/ipc/media.ts";
import { error_text } from "../storage/coerce.ts";
import type { RunOptions } from "../turn/run-options.ts";
import { empty_reply, invalid, json_reply, optional_choice, optional_flag, optional_list, read_json, RequestError, required_text } from "./body.ts";
import { parse_session_options, resolve_run_options } from "./options.ts";
import type { ApiContext, Handler } from "./router.ts";
import { require_session } from "./routes-sessions.ts";
import { admit_with_options, run_result, wait_run } from "./runs.ts";

const wait_modes: readonly WaitUntil[] = ["idle", "turn"];

const busy = (session_id: string) => new RequestError(409, "session_busy", `session ${session_id} already has a running turn`);

const prompt_text = (body: Record<string, unknown>) => required_text(body, "text", message_limits.text);

const attachment_ids = (context: ApiContext, body: Record<string, unknown>): string[] => {
  const ids = optional_list(body, "attachment_ids", attachment_limits.max_files, 200) ?? [];
  try {
    context.uploaded(ids);
  } catch (error) {
    throw invalid(error_text(error));
  }
  return ids;
};

const send_request = (chat_id: string, text: string, ids: string[], plan: boolean, options: RunOptions): SendRequest => ({
  chat_id,
  text,
  attachment_ids: ids,
  model: options.choice.model,
  effort: options.choice.effort,
  pro: options.choice.pro,
  ...(options.choice.tier ? { tier: options.choice.tier } : {}),
  mode: options.mode,
  plan,
  origin: "user",
});

const admitted = async (context: ApiContext, session_id: string, options: RunOptions, start: () => Promise<TurnStarted>): Promise<PromptStarted | null> => {
  if (context.is_active(session_id)) {
    throw busy(session_id);
  }
  try {
    return await admit_with_options(context, session_id, options, start);
  } catch (error) {
    if (context.is_active(session_id)) {
      throw busy(session_id);
    }
    throw error;
  }
};

const assistant_message = async (context: ApiContext, session_id: string, message_id: string) => {
  const chat = await context.invoke("chats:get", session_id);
  if (!chat?.messages.some((message) => message.id === message_id && message.role === "assistant")) {
    throw new RequestError(404, "not_found", `session ${session_id} has no assistant message ${message_id}`);
  }
};

export const turn_routes = {
  prompt: async ({ context, request, params }) => {
    require_session(context, params.id);
    const body = await read_json(request);
    const text = prompt_text(body);
    const ids = attachment_ids(context, body);
    const plan = optional_flag(body, "plan") ?? false;
    const options = await resolve_run_options(context, params.id, await parse_session_options(context, body));
    const started = await admitted(context, params.id, options, () => context.invoke("turn:send", send_request(params.id, text, ids, plan, options)));
    return json_reply(started, 202);
  },
  "run.get": async ({ context, response, url, params }) => {
    require_session(context, params.id);
    const until = optional_choice({ wait: url.searchParams.get("wait") ?? undefined }, "wait", wait_modes);
    if (!until) {
      return json_reply(await run_result(context, params.id, params.run_id));
    }
    const closed = new AbortController();
    response.once("close", () => closed.abort(new Error("the client closed the connection")));
    return json_reply(await wait_run(context, params.id, params.run_id, until, closed.signal));
  },
  stop: async ({ context, params }) => {
    require_session(context, params.id);
    await context.invoke("turn:stop", params.id);
    return empty_reply(204);
  },
  steer: async ({ context, request, params }) => {
    require_session(context, params.id);
    const body = await read_json(request);
    const text = prompt_text(body);
    const ids = attachment_ids(context, body);
    if (!(await context.invoke("turn:steer", params.id, text, ids, randomUUID()))) {
      throw new RequestError(404, "not_found", `session ${params.id} has no running turn that takes a steer`);
    }
    return empty_reply(204);
  },
  "plan.accept": async ({ context, request, params }) => {
    require_session(context, params.id);
    const message_id = required_text(await read_json(request), "message_id", 200);
    await assistant_message(context, params.id, message_id);
    const options = context.run_options(params.id) ?? (await resolve_run_options(context, params.id, {}));
    const started = await admitted(context, params.id, options, () => context.invoke("turn:accept_plan", params.id, message_id));
    return json_reply(started, 202);
  },
} satisfies Partial<Record<RouteId, Handler>>;
