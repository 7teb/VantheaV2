import { app } from "electron";
import http from "node:http";
import type { InvokeArgs, InvokeName, InvokeResult } from "../../shared/ipc/index.ts";
import { live_run } from "../agents/live.ts";
import type { ApiServer } from "../app/headless.ts";
import type { HeadlessConfig } from "../app/headless-args.ts";
import { chat_activity, chat_idle, when_idle } from "../app/idle.ts";
import { is_headless } from "../app/runtime.ts";
import { chat_meta } from "../chats/store.ts";
import { api_client, set_client_connected } from "../ipc/clients.ts";
import { add_event_tap, dispatch_invoke } from "../ipc/handle.ts";
import { uploaded } from "../media/uploads.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { pending_approvals } from "../permissions/approvals.ts";
import { get_settings } from "../settings/store.ts";
import { active_turn, ended_turn_settled, is_active, turn_settled } from "../turn/active.ts";
import { forget_run_options, run_options, set_run_options } from "../turn/run-options.ts";
import { start_events, stop_events } from "./events.ts";
import { api_handlers, check_handlers, route, type ApiContext } from "./router.ts";
import { start_runs, stop_runs } from "./runs.ts";

const invoke = <K extends InvokeName>(name: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>> =>
  dispatch_invoke(api_client, name, args) as Promise<InvokeResult<K>>;

const listen = (server: http.Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(new Error(`the local API could not listen on 127.0.0.1:${port}: ${error.message}`, { cause: error }));
    };
    const listening = () => {
      server.off("error", failed);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error(`the local API on 127.0.0.1:${port} reported no TCP address`));
        return;
      }
      resolve(address.port);
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });

const close_server = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });

export const start_api = async (config: HeadlessConfig): Promise<ApiServer> => {
  check_handlers(api_handlers);
  const server = http.createServer();
  const port = await listen(server, config.port);
  const context: ApiContext = {
    token: config.token,
    port,
    invoke,
    add_event_tap,
    session_meta: chat_meta,
    is_active,
    active_message: (chat_id) => active_turn(chat_id)?.message_id ?? null,
    turn_settled,
    ended_turn_settled,
    chat_activity,
    chat_idle,
    when_idle,
    pending_approvals,
    uploaded,
    protected_dirs: [config.data_dir, config.app_dir],
    run_options,
    set_run_options,
    forget_run_options,
    settings: () => {
      const { model, effort } = get_settings();
      return { model, effort };
    },
    model_catalog,
    version: app.getVersion(),
    headless: is_headless(),
    quit: () => app.quit(),
  };
  server.on("request", (request, response) => route(context, request, response));
  server.on("error", (error) => console.error(`[api] the local API server on port ${port} failed:`, error));
  set_client_connected(api_client, true);
  start_events(add_event_tap, (run_id) => live_run(run_id)?.chat_id ?? null);
  start_runs(context);
  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      try {
        await stop_runs(context);
      } finally {
        stop_events();
      }
      try {
        await close_server(server);
      } finally {
        set_client_connected(api_client, false);
      }
    })();
    return closing;
  };
  return { url: `http://127.0.0.1:${port}`, close };
};
