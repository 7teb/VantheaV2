import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { RouteId } from "../../shared/api/routes.ts";
import type { ChatMeta } from "../../shared/chat.ts";
import { path_within } from "../app/headless-args.ts";
import { error_text } from "../storage/coerce.ts";
import { empty_reply, invalid, json_reply, read_json, RequestError, required_text } from "./body.ts";
import { forget_session_options, parse_session_options, remember_session_options } from "./options.ts";
import type { ApiContext, Handler } from "./router.ts";
import { forget_session_runs } from "./runs.ts";

export const require_session = (context: ApiContext, session_id: string): ChatMeta => {
  const meta = context.session_meta(session_id);
  if (!meta) {
    throw new RequestError(404, "not_found", `session ${session_id} not found`);
  }
  return meta;
};

const project_directory = async (context: ApiContext, cwd: string): Promise<string> => {
  if (!path.isAbsolute(cwd)) {
    throw invalid(`cwd must be an absolute path, got ${cwd}`);
  }
  const resolved = path.resolve(cwd);
  let stats: Stats;
  let real: string;
  try {
    stats = await fs.stat(resolved);
    real = await fs.realpath(resolved);
  } catch (error) {
    throw invalid(`cwd ${resolved} cannot be read: ${error_text(error)}`);
  }
  if (!stats.isDirectory()) {
    throw invalid(`cwd ${resolved} is not a directory`);
  }
  const reserved = context.protected_dirs.find((dir) => path_within(dir, resolved) || path_within(dir, real));
  if (reserved) {
    throw invalid(`cwd ${resolved} lies in the VantheaX data folder ${reserved}, which cannot be a project`);
  }
  return resolved;
};

export const session_routes = {
  "sessions.list": async ({ context }) => json_reply(await context.invoke("chats:list")),
  "sessions.create": async ({ context, request }) => {
    const body = await read_json(request);
    const cwd = await project_directory(context, required_text(body, "cwd", 2000));
    const options = await parse_session_options(context, body);
    const meta = await context.invoke("chats:create", cwd);
    remember_session_options(meta.id, options);
    return json_reply(meta);
  },
  "sessions.get": async ({ context, params }) => {
    require_session(context, params.id);
    const chat = await context.invoke("chats:get", params.id);
    if (!chat) {
      throw new RequestError(404, "not_found", `session ${params.id} not found`);
    }
    return json_reply(chat);
  },
  "sessions.remove": async ({ context, params }) => {
    require_session(context, params.id);
    await context.invoke("chats:delete", params.id);
    forget_session_options(params.id);
    forget_session_runs(params.id);
    return empty_reply(204);
  },
} satisfies Partial<Record<RouteId, Handler>>;
