import type { AccountInfo, SignInRequest } from "../shared/api/contract.ts";
import type { ChatgptAccount } from "../shared/chatgpt.ts";
import type { AccountCommand, OutputFormat } from "./cli-args.ts";
import type { CallOptions, Client } from "./client.ts";

type AccountOutput = { out: (text: string) => void; err: (text: string) => void };

const opened_note = "the ChatGPT sign-in page was opened in the browser of the machine that runs VantheaX, finish the sign-in there";

const identity = (account: ChatgptAccount): string | null => account.email ?? account.name;

const failure_text = (account: ChatgptAccount): string => (account.error ? `${account.error.code}${account.error.detail ? `: ${account.error.detail}` : ""}` : "");

const plan_note = (account: ChatgptAccount): string[] =>
  account.status === "signed_in" && !account.plan_enabled ? ["plan usage is not enabled for this sign-in, run vantheax sign-in --consent to enable it"] : [];

export const account_lines = (info: AccountInfo): string[] => {
  const name = identity(info.chatgpt);
  return [
    `billing: ${info.billing}`,
    `chatgpt: ${info.chatgpt.status}${name ? ` (${name})` : ""}`,
    ...plan_note(info.chatgpt).map((note) => `chatgpt: ${note}`),
    ...(info.chatgpt.error ? [`chatgpt error: ${failure_text(info.chatgpt)}`] : []),
  ];
};

const account_line = (info: AccountInfo): string => `${JSON.stringify({ type: "account", account: info })}\n`;

export const follow_sign_in = async (client: Client, body: SignInRequest, options: CallOptions, on_opened: (info: AccountInfo) => void): Promise<AccountInfo> => {
  const signal = options.signal;
  const stream = client.events({ signal });
  try {
    const hello = await stream.next();
    if (hello.done || hello.value.type !== "hello") {
      throw new Error("the event stream did not open with a hello event");
    }
    const started = await client.account.sign_in(body, { signal });
    if (started.chatgpt.status !== "signing_in") {
      return started;
    }
    on_opened(started);
    let attempt_seen = false;
    for (;;) {
      const next = await stream.next();
      if (next.done) {
        throw new Error("the event stream ended before the ChatGPT sign-in finished");
      }
      const event = next.value;
      if (event.type === "resync") {
        const current = await client.account.get({ signal });
        if (current.chatgpt.status !== "signing_in") {
          return current;
        }
        attempt_seen = true;
        continue;
      }
      if (event.type !== "account.changed") {
        continue;
      }
      if (event.data.status === "signing_in") {
        attempt_seen = true;
        continue;
      }
      if (attempt_seen) {
        return { billing: started.billing, chatgpt: event.data };
      }
    }
  } finally {
    await stream.return();
  }
};

const sign_in = async (client: Client, command: Extract<AccountCommand, { name: "sign-in" }>, format: OutputFormat, options: CallOptions, output: AccountOutput): Promise<number> => {
  const info = await follow_sign_in(client, { fresh: command.fresh, consent: command.consent }, options, () => {
    if (format === "text") {
      output.err(`vantheax: ${opened_note}\n`);
    }
  });
  const signed_in = info.chatgpt.status === "signed_in";
  if (format === "json") {
    output.out(account_line(info));
    return signed_in ? 0 : 1;
  }
  if (!signed_in) {
    output.err(`vantheax: the ChatGPT sign-in did not finish: ${failure_text(info.chatgpt) || info.chatgpt.status}\n`);
    return 1;
  }
  output.out(`signed in to ChatGPT${identity(info.chatgpt) ? ` as ${identity(info.chatgpt)}` : ""}\n`);
  for (const note of plan_note(info.chatgpt)) {
    output.err(`vantheax: ${note}\n`);
  }
  return 0;
};

const sign_out = async (client: Client, format: OutputFormat, options: CallOptions, output: AccountOutput): Promise<number> => {
  const info = await client.account.sign_out(options);
  const failed = info.chatgpt.error !== null;
  if (format === "json") {
    output.out(account_line(info));
    return failed ? 1 : 0;
  }
  output.out("signed out of ChatGPT\n");
  if (failed) {
    output.err(`vantheax: ${failure_text(info.chatgpt)}\n`);
  }
  return failed ? 1 : 0;
};

const set_billing = async (client: Client, command: Extract<AccountCommand, { name: "billing" }>, format: OutputFormat, options: CallOptions, output: AccountOutput): Promise<number> => {
  const info = await client.account.set_billing(command.billing, options);
  if (format === "json") {
    output.out(account_line(info));
    return 0;
  }
  output.out(`billing: ${info.billing}\n`);
  if (info.billing === "chatgpt" && info.chatgpt.status !== "signed_in") {
    output.err("vantheax: not signed in to ChatGPT, run vantheax sign-in\n");
  }
  return 0;
};

export const run_account = async (client: Client, command: AccountCommand, format: OutputFormat, options: CallOptions, output: AccountOutput): Promise<number> => {
  if (command.name === "sign-in") {
    return sign_in(client, command, format, options, output);
  }
  if (command.name === "sign-out") {
    return sign_out(client, format, options, output);
  }
  if (command.name === "billing") {
    return set_billing(client, command, format, options, output);
  }
  const info = await client.account.get(options);
  output.out(format === "json" ? account_line(info) : account_lines(info).map((line) => `${line}\n`).join(""));
  return 0;
};
