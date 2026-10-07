import { running_in_chat } from "../agents/store.ts";
import type { ToolContext } from "../tools/types.ts";
import { split_statements } from "./statements.ts";

const powershell_delay = /^(?:&\s*)?(?:Microsoft\.PowerShell\.Utility\\)?(?:Start-Sleep|sleep)(?=\s|$)|^&\s*(["\'])(?:Microsoft\.PowerShell\.Utility\\)?(?:Start-Sleep|sleep)\1(?=\s|$)/i;
const interpreter_delay = /^(?:&\s*)?["\']?(?:[^"\'\s]*[\\/])?(?:python(?:\d+(?:\.\d+)?)?|py|node)(?:\.exe)?["\']?(?=\s|$)/i;
const timer_call = /\b(?:time|asyncio)\.sleep\s*\(|\bsetTimeout\s*\(|\b(?:Thread|Task)\]::(?:Sleep|Delay)\s*\(/i;
const external_delay = /^(?:timeout(?:\.exe)?\s+\/t\b|ping(?:\.exe)?\b[\s\S]*\s-n\s+\d+)/i;
const agent_wait = /\b(?:wait(?:ing|ed)?|sleep(?:ing)?|hold(?:ing)?)\b[\s\S]{0,100}\b(?:sub[-_ ]?agents?|agents?|readers?|reviewers?|reports?)\b|\b(?:sub[-_ ]?agents?|agents?|readers?|reviewers?)\b[\s\S]{0,100}\b(?:finish(?:ed|ing)?|complet(?:e|ed|ion)|reports?)\b/i;

const agent_reason = "Do not use sleep commands to wait for agents. End your current model response normally with no visible text and no tool calls. Agent reports arrive automatically and the harness resumes the work. Do not print stop_reason or finish_reason.";
const delay_reason = "PowerShell Start-Sleep and its sleep alias are not available. " + agent_reason + " For a genuinely necessary delay in another task, use an already available Python time.sleep or an appropriate bounded wait; never use these alternatives to keep waiting for agents.";

export const rejected_text = (reason: string): string => "Tool call rejected [" + reason + "]";

export const sleep_reason = (command: string, agents_running: boolean): string | null => {
  const statements = split_statements(command).map(statement => statement.replaceAll(String.fromCharCode(96), "").trim());
  if (statements.some(statement => powershell_delay.test(statement))) return delay_reason;
  if (!agents_running || !agent_wait.test(command)) return null;
  const delay = statements.some(statement => external_delay.test(statement) ||
    (interpreter_delay.test(statement) && timer_call.test(statement)) || /^\[System\.Threading\.(?:Thread|Tasks\.Task)\]::(?:Sleep|Delay)\s*\(/i.test(statement));
  return delay ? agent_reason : null;
};

export const command_sleep_reason = (ctx: ToolContext, command: string): string | null =>
  sleep_reason(command, ctx.profile === "main" && running_in_chat(ctx.chat_id) > 0);
