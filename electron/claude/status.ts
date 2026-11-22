import type { ClaudeAccount, ClaudeStatus } from "../../shared/claude.ts";
import { error_text, is_record } from "../storage/coerce.ts";
import { claude_executable } from "./executable.ts";
import { run_claude, type ClaudeRun } from "./process.ts";

type AccountFields = Pick<ClaudeAccount, "email" | "subscription" | "auth_method">;

const no_fields: AccountFields = { email: null, subscription: null, auth_method: null };

const text_field = (raw: Record<string, unknown>, name: string): string | null => {
  const value = raw[name];
  return typeof value === "string" ? value : null;
};

const first_line = (text: string): string => (text.trim().split(/\r?\n/)[0] ?? "").slice(0, 300);

const account_of = (status: ClaudeStatus, login_command: string, fields: AccountFields = no_fields, detail = ""): ClaudeAccount => ({
  status,
  ...fields,
  login_command,
  detail,
});

export const unknown_claude_account: ClaudeAccount = account_of("unknown", "");

export const claude_login_command = (executable: string): string => `& '${executable.replaceAll("'", "''")}' auth login --claudeai`;

const parse_status = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return is_record(value) ? value : null;
  } catch (error) {
    console.warn("[claude] claude auth status printed no JSON object:", error_text(error), first_line(text));
    return null;
  }
};

const account_from_run = (run: ClaudeRun, login_command: string): ClaudeAccount => {
  if (run.code === 1) {
    return account_of("signed_out", login_command);
  }
  if (run.code !== 0) {
    const reason = first_line(run.stderr) || first_line(run.stdout);
    return account_of("error", login_command, no_fields, `claude auth status exited with code ${run.code ?? "none"}${reason ? `: ${reason}` : ""}`);
  }
  const raw = parse_status(run.stdout);
  if (!raw || typeof raw.loggedIn !== "boolean") {
    return account_of("error", login_command, no_fields, `claude auth status printed an unexpected answer: ${first_line(run.stdout) || "nothing"}`);
  }
  if (!raw.loggedIn) {
    return account_of("signed_out", login_command);
  }
  const auth_method = text_field(raw, "authMethod");
  const fields = { email: text_field(raw, "email"), subscription: text_field(raw, "subscriptionType"), auth_method };
  return account_of(auth_method === "claude.ai" ? "signed_in" : "other_login", login_command, fields);
};

export const probe_claude_account = async (run: (args: string[]) => Promise<ClaudeRun> = run_claude, executable: () => string = claude_executable): Promise<ClaudeAccount> => {
  let login_command: string;
  try {
    login_command = claude_login_command(executable());
  } catch (error) {
    console.warn("[claude] the Claude Code executable is not available:", error_text(error));
    return account_of("missing", "", no_fields, error_text(error));
  }
  let output: ClaudeRun;
  try {
    output = await run(["auth", "status", "--json"]);
  } catch (error) {
    console.warn("[claude] starting claude auth status failed:", error_text(error));
    return account_of("missing", "", no_fields, error_text(error));
  }
  return account_from_run(output, login_command);
};
