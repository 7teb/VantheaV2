export type ClaudeStatus = "unknown" | "missing" | "signed_out" | "signed_in" | "other_login" | "error";

export type ClaudeAccount = {
  status: ClaudeStatus;
  email: string | null;
  subscription: string | null;
  auth_method: string | null;
  login_command: string;
  detail: string;
};
