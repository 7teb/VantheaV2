import type { IncomingMessage } from "node:http";
import type { AccountInfo } from "../../shared/api/contract.ts";
import type { RouteId } from "../../shared/api/routes.ts";
import type { ChatgptAccount } from "../../shared/chatgpt.ts";
import type { ClaudeAccount } from "../../shared/claude.ts";
import { billing_modes, claude_billing_modes, type SettingsView } from "../../shared/settings.ts";
import { invalid, json_limit, json_reply, optional_choice, optional_flag, read_json, read_raw } from "./body.ts";
import type { ApiContext, Handler } from "./router.ts";

type KnownAccount = { settings?: Pick<SettingsView, "billing" | "claude_billing">; chatgpt?: ChatgptAccount; claude?: ClaudeAccount };

const account_info = async (context: ApiContext, known: KnownAccount = {}): Promise<AccountInfo> => {
  const settings = known.settings ?? (await context.invoke("settings:get"));
  const chatgpt = known.chatgpt ?? (await context.invoke("chatgpt:status"));
  const claude = known.claude ?? (await context.invoke("claude:status"));
  return { billing: settings.billing, chatgpt, claude_billing: settings.claude_billing, claude };
};

const optional_body = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  if (request.headers["content-type"] !== undefined) {
    return read_json(request);
  }
  if ((await read_raw(request, json_limit)).length) {
    throw invalid("the content type must be application/json");
  }
  return {};
};

export const account_routes = {
  "account.get": async ({ context }) => json_reply(await account_info(context)),
  "account.billing": async ({ context, request }) => {
    const billing = optional_choice(await read_json(request), "billing", billing_modes);
    if (billing === undefined) {
      throw invalid(`billing must be one of ${billing_modes.join(", ")}`);
    }
    return json_reply(await account_info(context, { settings: await context.invoke("settings:update", { billing }) }));
  },
  "account.sign_in": async ({ context, request }) => {
    const raw = await optional_body(request);
    const fresh = optional_flag(raw, "fresh") ?? false;
    const consent = optional_flag(raw, "consent") ?? false;
    return json_reply(await account_info(context, { chatgpt: await context.invoke("chatgpt:sign_in", { fresh, consent }) }));
  },
  "account.sign_out": async ({ context }) => json_reply(await account_info(context, { chatgpt: await context.invoke("chatgpt:sign_out") })),
  "account.claude_billing": async ({ context, request }) => {
    const claude_billing = optional_choice(await read_json(request), "billing", claude_billing_modes);
    if (claude_billing === undefined) {
      throw invalid(`billing must be one of ${claude_billing_modes.join(", ")}`);
    }
    return json_reply(await account_info(context, { settings: await context.invoke("settings:update", { claude_billing }) }));
  },
  "account.claude_refresh": async ({ context }) => json_reply(await account_info(context, { claude: await context.invoke("claude:refresh") })),
} satisfies Partial<Record<RouteId, Handler>>;
