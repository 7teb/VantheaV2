import type { AssistantMessage } from "../../../shared/chat.ts";
import { compact_tokens } from "../../components/token-count.ts";
import type { Translate } from "../../i18n/translate.ts";
import { effort_label } from "../composer/composer-hooks.ts";
import { format_duration } from "../tools/tool-summary.ts";

export const turn_info = (t: Translate, message: AssistantMessage, started_at: string): string => {
  const span = message.ended_at ? Date.parse(message.ended_at) - Date.parse(started_at) : null;
  const context = message.context;
  return [
    ...(message.effort ? [effort_label(t, message.effort)] : []),
    ...(span !== null && span >= 0 ? [format_duration(span)] : []),
    ...(context ? [t("chat.info_context", { used: compact_tokens(context.used), limit: compact_tokens(context.limit) })] : []),
  ].join(" · ");
};
