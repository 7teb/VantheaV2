import type { ChatgptSignIn } from "../../shared/chatgpt.ts";
import { cancel_sign_in, chatgpt_account, dismiss_notice, sign_out, start_sign_in } from "../chatgpt/service.ts";
import { require_record } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const parse_sign_in = (value: unknown): ChatgptSignIn => {
  const raw = require_record(value, "ChatGPT sign-in request");
  if (typeof raw.fresh !== "boolean" || typeof raw.consent !== "boolean") {
    throw new Error("ChatGPT sign-in request must carry boolean fresh and consent fields");
  }
  return { fresh: raw.fresh, consent: raw.consent };
};

export const register_chatgpt_ipc = () => {
  handle("chatgpt:status", () => chatgpt_account());
  handle("chatgpt:sign_in", (request) => start_sign_in(parse_sign_in(request)));
  handle("chatgpt:cancel_sign_in", () => cancel_sign_in());
  handle("chatgpt:sign_out", () => sign_out());
  handle("chatgpt:dismiss_notice", () => dismiss_notice());
};
