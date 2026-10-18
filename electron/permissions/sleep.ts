import { running_in_chat } from "../agents/store.ts";
import type { ToolContext } from "../tools/types.ts";
import { split_statements, type Dialect } from "./statements.ts";

const powershell_delay = /^(?:&\s*)?(?:Microsoft\.PowerShell\.Utility\\)?(?:Start-Sleep|sleep)(?=\s|$)|^&\s*(["\'])(?:Microsoft\.PowerShell\.Utility\\)?(?:Start-Sleep|sleep)\1(?=\s|$)/i;
const interpreter_delay = /^(?:&\s*)?["\']?(?:[^"\'\s]*[\\/])?(?:python(?:\d+(?:\.\d+)?)?|py|node)(?:\.exe)?["\']?(?=\s|$)/i;
const timer_call = /\b(?:time|asyncio)\.sleep\s*\(|\bsetTimeout\s*\(|\b(?:Thread|Task)\]::(?:Sleep|Delay)\s*\(/i;
const external_delay = /^(?:timeout(?:\.exe)?\s+\/t\b|ping(?:\.exe)?\b[\s\S]*\s-n\s+\d+)/i;
const agent_wait = /\b(?:wait(?:ing|ed)?|sleep(?:ing)?|hold(?:ing)?)\b[\s\S]{0,100}\b(?:sub[-_ ]?agents?|agents?|readers?|reviewers?|reports?)\b|\b(?:sub[-_ ]?agents?|agents?|readers?|reviewers?)\b[\s\S]{0,100}\b(?:finish(?:ed|ing)?|complet(?:e|ed|ion)|reports?)\b/i;

const agent_reason = "Do not use sleep commands to wait for agents. End your current model response with one short sentence that says what you are waiting for, and no tool calls. Agent reports arrive automatically and the harness resumes the work.";

export const rejected_text = (reason: string): string => "Tool call rejected [" + reason + "]";

export const sleep_reason = (command: string, agents_running: boolean, dialect: Dialect = "powershell"): string | null => {
  const statements = split_statements(command, dialect).map(statement => statement.replaceAll(String.fromCharCode(96), "").trim());
  if (!agents_running || !agent_wait.test(command)) return null;
  const delay = statements.some(statement => powershell_delay.test(statement) || external_delay.test(statement) ||
    (interpreter_delay.test(statement) && timer_call.test(statement)) || /^\[System\.Threading\.(?:Thread|Tasks\.Task)\]::(?:Sleep|Delay)\s*\(/i.test(statement));
  return delay ? agent_reason : null;
};

export const command_sleep_reason = (ctx: ToolContext, command: string, dialect: Dialect = "powershell"): string | null =>
  sleep_reason(command, ctx.profile === "main" && running_in_chat(ctx.chat_id) > 0, dialect);
