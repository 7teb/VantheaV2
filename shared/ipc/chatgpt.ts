import type { ChatgptAccount, ChatgptSignIn } from "../chatgpt.ts";
import { emit, invoke } from "./channel.ts";

export const chatgpt_channels = {
  "chatgpt:status": invoke<[], ChatgptAccount>(),
  "chatgpt:sign_in": invoke<[request: ChatgptSignIn], ChatgptAccount>(),
  "chatgpt:cancel_sign_in": invoke<[], ChatgptAccount>(),
  "chatgpt:sign_out": invoke<[], ChatgptAccount>(),
  "chatgpt:dismiss_notice": invoke<[], ChatgptAccount>(),
  "chatgpt:changed": emit<ChatgptAccount>(),
} as const;
