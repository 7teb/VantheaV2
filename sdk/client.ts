import type {
  AccountInfo,
  ApiEvent,
  ApprovalInfo,
  ApprovalReply,
  InfoResult,
  ModelInfo,
  PromptRequest,
  PromptStarted,
  RunResult,
  Session,
  SessionCreate,
  SessionInfo,
  SignInRequest,
  SteerRequest,
  WaitUntil,
} from "../shared/api/contract.ts";
import type { Attachment } from "../shared/chat.ts";
import type { GitFileDiff } from "../shared/git-view.ts";
import type { OpenQuestion, QuestionAnswer } from "../shared/questions.ts";
import type { BillingMode, ClaudeBillingMode } from "../shared/settings.ts";
import type { DiffSummary } from "../shared/turn-diff.ts";
import { events, type EventsOptions } from "./events.ts";
import { error_text, request, VantheaxError, type ClientConfig } from "./http.ts";

export type CallOptions = { signal?: AbortSignal };

export type WaitOptions = CallOptions & {
  until?: WaitUntil;
  on_event?: (event: ApiEvent) => void;
  on_approval?: (info: ApprovalInfo) => ApprovalReply | Promise<ApprovalReply>;
};

export type RunOptions = WaitOptions & { on_started?: (started: PromptStarted) => void };

export type Upload = { name: string; mime: string; bytes: Uint8Array };

export type DiffOptions<P extends string | undefined> = CallOptions & { path?: P };

export type Client = {
  info: (options?: CallOptions) => Promise<InfoResult>;
  models: (options?: CallOptions) => Promise<ModelInfo[]>;
  account: {
    get: (options?: CallOptions) => Promise<AccountInfo>;
    set_billing: (billing: BillingMode, options?: CallOptions) => Promise<AccountInfo>;
    sign_in: (body?: SignInRequest, options?: CallOptions) => Promise<AccountInfo>;
    sign_out: (options?: CallOptions) => Promise<AccountInfo>;
    set_claude_billing: (billing: ClaudeBillingMode, options?: CallOptions) => Promise<AccountInfo>;
    refresh_claude: (options?: CallOptions) => Promise<AccountInfo>;
  };
  sessions: {
    create: (body: SessionCreate, options?: CallOptions) => Promise<SessionInfo>;
    list: (options?: CallOptions) => Promise<SessionInfo[]>;
    get: (session_id: string, options?: CallOptions) => Promise<Session>;
    remove: (session_id: string, options?: CallOptions) => Promise<void>;
  };
  prompt: (session_id: string, body: PromptRequest, options?: CallOptions) => Promise<PromptStarted>;
  result: (session_id: string, run_id: string, options?: CallOptions) => Promise<RunResult>;
  wait: (session_id: string, run_id: string, options?: WaitOptions) => Promise<RunResult>;
  run: (session_id: string, body: PromptRequest, options?: RunOptions) => Promise<RunResult>;
  stop: (session_id: string, options?: CallOptions) => Promise<void>;
  steer: (session_id: string, body: SteerRequest, options?: CallOptions) => Promise<void>;
  approvals: {
    list: (session_id: string, options?: CallOptions) => Promise<ApprovalInfo[]>;
    reply: (session_id: string, approval_id: string, reply: ApprovalReply, options?: CallOptions) => Promise<void>;
    hold: (session_id: string, approval_id: string, options?: CallOptions) => Promise<void>;
  };
  questions: {
    list: (session_id: string, options?: CallOptions) => Promise<OpenQuestion[]>;
    answer: (session_id: string, answers: QuestionAnswer[], options?: CallOptions) => Promise<PromptStarted | null>;
    dismiss: (session_id: string, ids: string[], options?: CallOptions) => Promise<void>;
  };
  plan: {
    accept: (session_id: string, message_id: string, options?: CallOptions) => Promise<PromptStarted>;
  };
  attachments: {
    upload: (file: Upload, options?: CallOptions) => Promise<Attachment>;
  };
  diff: <P extends string | undefined = undefined>(session_id: string, options?: DiffOptions<P>) => Promise<P extends string ? GitFileDiff : DiffSummary[]>;
  events: (options?: EventsOptions) => AsyncGenerator<ApiEvent, void, undefined>;
  shutdown: (options?: CallOptions) => Promise<void>;
};

type Follow = {
  session_id: string;
  until: WaitUntil;
  options: WaitOptions;
  start: () => Promise<string>;
};

const approval_event = (event: ApiEvent): boolean =>
  (event.type === "turn.event" && event.data.type === "tool_approval") || event.type === "agent.approvals_changed";

export const create_client = (config: ClientConfig): Client => {
  const client: Client = {
    info: (options = {}) => request(config, "info", {}, options),
    models: (options = {}) => request(config, "models", {}, options),
    account: {
      get: (options = {}) => request(config, "account.get", {}, options),
      set_billing: (billing, options = {}) => request(config, "account.billing", {}, { body: { billing }, signal: options.signal }),
      sign_in: (body = {}, options = {}) => request(config, "account.sign_in", {}, { body, signal: options.signal }),
      sign_out: (options = {}) => request(config, "account.sign_out", {}, options),
      set_claude_billing: (billing, options = {}) => request(config, "account.claude_billing", {}, { body: { billing }, signal: options.signal }),
      refresh_claude: (options = {}) => request(config, "account.claude_refresh", {}, options),
    },
    sessions: {
      create: (body, options = {}) => request(config, "sessions.create", {}, { body, signal: options.signal }),
      list: (options = {}) => request(config, "sessions.list", {}, options),
      get: (session_id, options = {}) => request(config, "sessions.get", { id: session_id }, options),
      remove: (session_id, options = {}) => request(config, "sessions.remove", { id: session_id }, options),
    },
    prompt: (session_id, body, options = {}) => request(config, "prompt", { id: session_id }, { body, signal: options.signal }),
    result: (session_id, run_id, options = {}) => request(config, "run.get", { id: session_id, run_id }, options),
    wait: (session_id, run_id, options = {}) => follow_run({ session_id, until: options.until ?? "idle", options, start: async () => run_id }, true),
    run: (session_id, body, options = {}) =>
      follow_run(
        {
          session_id,
          until: options.until ?? "idle",
          options,
          start: async () => {
            const started = await client.prompt(session_id, body, options);
            options.on_started?.(started);
            return started.run_id;
          },
        },
        false,
      ),
    stop: (session_id, options = {}) => request(config, "stop", { id: session_id }, options),
    steer: (session_id, body, options = {}) => request(config, "steer", { id: session_id }, { body, signal: options.signal }),
    approvals: {
      list: (session_id, options = {}) => request(config, "approvals.list", { id: session_id }, options),
      reply: (session_id, approval_id, reply, options = {}) =>
        request(config, "approvals.reply", { id: session_id, approval_id }, { body: reply, signal: options.signal }),
      hold: (session_id, approval_id, options = {}) => request(config, "approvals.hold", { id: session_id, approval_id }, options),
    },
    questions: {
      list: (session_id, options = {}) => request(config, "questions.list", { id: session_id }, options),
      answer: async (session_id, answers, options = {}) => {
        const started: PromptStarted | undefined = await request(config, "questions.reply", { id: session_id }, { body: { answers }, signal: options.signal });
        return started ?? null;
      },
      dismiss: async (session_id, ids, options = {}) => {
        await request(config, "questions.reply", { id: session_id }, { body: { dismiss: ids }, signal: options.signal });
      },
    },
    plan: {
      accept: (session_id, message_id, options = {}) =>
        request(config, "plan.accept", { id: session_id }, { body: { message_id }, signal: options.signal }),
    },
    attachments: {
      upload: (file, options = {}) =>
        request(config, "attachments.upload", {}, {
          raw: { bytes: file.bytes, headers: { "content-type": file.mime, "x-vx-name": encodeURIComponent(file.name) } },
          signal: options.signal,
        }),
    },
    diff: (session_id, options = {}) => request(config, "diff", { id: session_id }, { query: { path: options.path }, signal: options.signal }),
    events: (options = {}) => events(config, options),
    shutdown: async (options = {}) => {
      await request(config, "shutdown", {}, options);
    },
  };

  const turn_state = async (session_id: string, run_id: string, signal: AbortSignal | undefined) => {
    const session = await client.sessions.get(session_id, { signal });
    const message = session.messages.find((entry) => entry.id === run_id);
    const ended = message?.role === "assistant" && message.status !== "streaming";
    return { ended, settled: ended && !session.streaming };
  };

  const answer_approvals = async (target: Follow, handled: Set<string>, on_approval: NonNullable<WaitOptions["on_approval"]>) => {
    const signal = target.options.signal;
    for (const info of await client.approvals.list(target.session_id, { signal })) {
      if (handled.has(info.approval_id)) {
        continue;
      }
      handled.add(info.approval_id);
      const reply = await on_approval(info);
      await client.approvals.reply(target.session_id, info.approval_id, reply, { signal }).catch((error: unknown) => {
        if (!(error instanceof VantheaxError && error.code === "not_found")) {
          throw error;
        }
      });
    }
  };

  const follow_run = async (target: Follow, check_first: boolean): Promise<RunResult> => {
    const { session_id, until, options } = target;
    const stream = events(config, { session_id, signal: options.signal });
    try {
      const hello = await stream.next();
      if (hello.done || hello.value.type !== "hello") {
        throw new Error("the event stream did not open with a hello event");
      }
      options.on_event?.(hello.value);
      const run_id = await target.start();
      const signal = options.signal;
      const handled = new Set<string>();
      let turn_ended = false;
      let app_closed = false;
      const closed_by_app = (error: unknown): never => {
        if (app_closed && !signal?.aborted) {
          throw new VantheaxError(503, "shutting_down", `VantheaX shut down while run ${run_id} was open: ${error_text(error)}`);
        }
        throw error;
      };
      const final_result = () => client.result(session_id, run_id, { signal }).catch(closed_by_app);
      const settled_now = async (): Promise<RunResult | null> => {
        if (until === "turn") {
          const state = await turn_state(session_id, run_id, signal);
          turn_ended = turn_ended || state.ended;
          if (state.settled) {
            return client.result(session_id, run_id, { signal });
          }
        }
        const result = await client.result(session_id, run_id, { signal });
        return result.status === "running" ? null : result;
      };
      if (check_first) {
        const settled = await settled_now();
        if (settled) {
          return settled;
        }
      }
      if (options.on_approval) {
        await answer_approvals(target, handled, options.on_approval);
      }
      for (;;) {
        const next = await stream.next().catch(closed_by_app);
        if (next.done) {
          return closed_by_app(new Error("the event stream ended before the run settled"));
        }
        const event = next.value;
        options.on_event?.(event);
        if (event.type === "turn.event" && event.data.type === "end" && event.data.error?.kind === "app_closed") {
          app_closed = true;
        }
        if (event.type === "run.settled" && event.data.run_id === run_id) {
          return final_result();
        }
        if (until === "turn" && event.type === "turn.event" && event.data.message_id === run_id && event.data.type === "end") {
          turn_ended = true;
        }
        if (turn_ended && event.type === "session.updated" && event.data.id === session_id && !event.data.streaming) {
          return final_result();
        }
        if (event.type === "resync") {
          const settled = await settled_now();
          if (settled) {
            return settled;
          }
        }
        if (options.on_approval && (event.type === "resync" || approval_event(event))) {
          await answer_approvals(target, handled, options.on_approval);
        }
      }
    } finally {
      await stream.return();
    }
  };

  return client;
};
