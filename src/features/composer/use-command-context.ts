import type { ContextUsage } from "../../../shared/chat.ts";
import { with_choice, type ModelEntry, type SpeedTier } from "../../../shared/models.ts";
import type { ModelContext } from "../../../shared/settings.ts";
import { use_t } from "../../i18n/index.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { chats_store } from "../../state/chats.ts";
import { models_store } from "../../state/models.ts";
import { use_store } from "../../state/use-store.ts";
import type { CommandContext } from "./command-menu.ts";

type CommandInputs = {
  chat_id: string | null;
  project_path: string;
  draft_key: string;
  busy: boolean;
  compacting: boolean;
  plan: boolean;
  visualize: boolean;
  usage: ContextUsage | null;
  model: ModelEntry | null;
  model_context: ModelContext | undefined;
  pro: boolean;
  tier: SpeedTier | null;
  report: CommandContext["report"];
};

export const use_command_context = ({ chat_id, project_path, draft_key, busy, compacting, plan, visualize, usage, model, model_context, pro, tier, report }: CommandInputs): CommandContext => {
  const t = use_t();
  const chat = use_store(chats_store, (state) => (chat_id === null ? null : (state.list.find((entry) => entry.id === chat_id) ?? null)));
  const last_message_id = use_store(chat_view_store, (state) => (chat_id === null ? null : (state.entries[chat_id]?.chat?.messages.at(-1)?.id ?? null)));
  const catalog = use_store(models_store, (state) => state.catalog);
  const pro_locked = use_store(models_store, (state) => model !== null && (state.catalog?.pro_locked?.includes(model.id) ?? false));
  const usage_percent = usage && usage.limit > 0 ? Math.round(Math.min(1, usage.used / usage.limit) * 100) : null;
  const tiers = model ? with_choice(model, { pro }, catalog).tiers : undefined;
  return { chat_id, project_path, draft_key, chat, last_message_id, busy, compacting, plan, visualize, usage_percent, model, model_context, pro, pro_locked, tier, tiers, t, report };
};
