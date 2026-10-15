import type { ToolView } from "../../../shared/tool-view.ts";
import { take_dialog_report } from "../../browser/dialogs.ts";
import { error_text } from "../../browser/state.ts";
import { chat_tabs } from "../../browser/tabs.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const browser_view = (action: string, url: string, title: string, detail: string): ToolView => ({ kind: "browser", action, url, title, detail });

export const done = (text: string, view: ToolView): ToolResult => ({ status: "done", text, view });

const with_dialogs = (chat_id: string, result: ToolResult): ToolResult => {
  const report = take_dialog_report(chat_tabs(chat_id));
  return report ? { ...result, text: `${report}\n\n${result.text}` } : result;
};

export const guarded = async (ctx: ToolContext, action: string, work: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return with_dialogs(ctx.chat_id, await work());
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    const message = error_text(error);
    console.warn(`[browser] ${action} failed: ${message}`);
    return with_dialogs(ctx.chat_id, { status: "failed", text: message, view: null });
  }
};
