export const chatgpt_usage_url = "https://chatgpt.com/settings/usage";

export type ChatgptStatus = "signed_out" | "signing_in" | "signed_in" | "expired";

export type ChatgptErrorCode =
  | "cancelled"
  | "declined"
  | "wrong_account"
  | "registration_incomplete"
  | "token_invalid"
  | "network"
  | "storage_unavailable"
  | "open_failed"
  | "revocation_unconfirmed";

export type ChatgptAccount = {
  status: ChatgptStatus;
  email: string | null;
  name: string | null;
  plan_enabled: boolean;
  notice_seen: boolean;
  error: { code: ChatgptErrorCode; detail: string } | null;
};

export type ChatgptSignIn = { fresh: boolean; consent: boolean };

export type AccountModel = { slug: string; display_name: string; context_window: number | null; service_tiers: string[] };
