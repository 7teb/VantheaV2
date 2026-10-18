import type { CompactResult } from "../../../shared/ipc/chats.ts";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChartPieIcon,
  ClipboardListIcon,
  FilePenIcon,
  FoldVerticalIcon,
  ForkIcon,
  GitBranchPlusIcon,
  PercentIcon,
  PinIcon,
  PinOffIcon,
  RulerIcon,
  WormIcon,
} from "../../components/icons.tsx";
import type { MessageKey } from "../../i18n/translate.ts";
import { fork_chat } from "../../state/chat-actions.ts";
import { visualize_chip } from "../../state/chat-drafts.ts";
import { set_chat_archived, set_chat_pinned } from "../../state/chats.ts";
import { compact_now, start_init, toggle_draft_chip, toggle_plan } from "../../state/composer.ts";
import { open_memories } from "../../state/memories-panel.ts";
import { set_auto_compact, set_context_limit } from "../../state/settings.ts";
import type { ComposerCommand } from "./command-menu.ts";
import { auto_compact_options, chosen_hint, command_options, context_limit_options } from "./context-options.ts";

const compact_notes: Record<Exclude<CompactResult["status"], "done">, { key: MessageKey; tone: "note" | "error" }> = {
  nothing: { key: "context.compact_nothing", tone: "note" },
  busy: { key: "context.compact_busy", tone: "note" },
  failed: { key: "context.compaction_failed", tone: "error" },
};

export const composer_commands: ComposerCommand[] = [
  {
    id: "compact",
    needs: "idle_chat",
    icon: () => FoldVerticalIcon,
    label: ({ t }) => t("commands.compact"),
    keywords: ["context", "summary"],
    hint: ({ t, usage_percent }) => (usage_percent === null ? t("commands.compact_summary") : t("commands.compact_hint", { percent: usage_percent })),
    blocked: ({ t, compacting }) => (compacting ? t("commands.compacting") : null),
    run: async ({ chat_id, t, report }) => {
      const status = await compact_now(chat_id);
      if (status !== "done") {
        report(t(compact_notes[status].key), compact_notes[status].tone);
      }
    },
  },
  {
    id: "auto_compact",
    needs: "model",
    icon: () => PercentIcon,
    label: ({ t }) => t("context.auto_compact"),
    keywords: ["compact", "threshold", "context"],
    hint: ({ t, model, model_context }) => chosen_hint(t, model, auto_compact_options(t, model, model_context)),
    options: ({ t, model, model_context }) => command_options(auto_compact_options(t, model, model_context), (option) => set_auto_compact(model, option.percent)),
  },
  {
    id: "context_limit",
    needs: "model",
    icon: () => RulerIcon,
    label: ({ t }) => t("context.limit"),
    keywords: ["limit", "context", "tokens", "window"],
    hint: ({ t, model, model_context }) => chosen_hint(t, model, context_limit_options(t, model, model_context)),
    options: ({ t, model, model_context }) => command_options(context_limit_options(t, model, model_context), (option) => set_context_limit(model, option.limit)),
  },
  {
    id: "archive",
    needs: "chat",
    icon: ({ chat }) => (chat?.archived ? ArchiveRestoreIcon : ArchiveIcon),
    label: ({ t, chat }) => t(chat?.archived ? "commands.unarchive" : "commands.archive"),
    keywords: ["unarchive", "restore", "hide"],
    hint: ({ t, chat }) => t(chat.archived ? "commands.unarchive_hint" : "commands.archive_hint"),
    blocked: ({ t, chat, busy }) => (busy && !chat.archived ? t("commands.turn_running") : null),
    run: ({ chat_id, chat }) => set_chat_archived(chat_id, !chat.archived),
  },
  {
    id: "pin",
    needs: "chat",
    icon: ({ chat }) => (chat?.pinned ? PinOffIcon : PinIcon),
    label: ({ t, chat }) => t(chat?.pinned ? "commands.unpin" : "commands.pin"),
    keywords: ["unpin"],
    hint: ({ t, chat }) => t(chat.pinned ? "commands.unpin_hint" : "commands.pin_hint"),
    blocked: ({ t, chat }) => (chat.archived ? t("commands.pin_archived") : null),
    run: ({ chat_id, chat }) => set_chat_pinned(chat_id, !chat.pinned),
  },
  {
    id: "fork",
    needs: "idle_chat",
    icon: () => ForkIcon,
    label: ({ t }) => t("commands.fork"),
    keywords: ["branch", "copy"],
    hint: ({ t }) => t("commands.fork_hint"),
    run: async ({ chat_id, last_message_id, t, report }) => {
      if (last_message_id === null) {
        report(t("commands.no_messages"), "note");
        return;
      }
      const result = await fork_chat(chat_id, last_message_id);
      if (!result.ok) {
        report(t("commands.failed", { action: t("commands.fork"), error: result.error }), "error");
      }
    },
  },
  {
    id: "memories",
    needs: "none",
    icon: () => WormIcon,
    label: ({ t }) => t("memories.title"),
    keywords: ["memory", "remember"],
    hint: ({ t }) => t("commands.memories_hint"),
    run: ({ draft_key }) => open_memories(draft_key),
  },
  {
    id: "init",
    needs: "project",
    icon: () => FilePenIcon,
    label: ({ t }) => t("commands.init"),
    keywords: ["agents.md", "setup"],
    hint: ({ t }) => t("commands.init_hint"),
    blocked: ({ t, compacting }) => (compacting ? t("commands.compacting") : null),
    run: ({ chat_id, project_path }) => start_init(chat_id, project_path, "init"),
  },
  {
    id: "git_init",
    needs: "project",
    icon: () => GitBranchPlusIcon,
    label: ({ t }) => t("commands.git_init"),
    keywords: ["gitinit", "git", "github", "repository", "publish"],
    hint: ({ t }) => t("commands.git_init_hint"),
    blocked: ({ t, compacting }) => (compacting ? t("commands.compacting") : null),
    run: ({ chat_id, project_path }) => start_init(chat_id, project_path, "git_init"),
  },
  {
    id: "plan",
    needs: "none",
    icon: () => ClipboardListIcon,
    label: ({ t }) => t("commands.plan"),
    keywords: ["planning"],
    hint: ({ t }) => t("commands.plan_hint"),
    toggled: ({ plan }) => plan,
    run: ({ draft_key }) => toggle_plan(draft_key),
  },
  {
    id: "visualize",
    needs: "none",
    icon: () => ChartPieIcon,
    label: ({ t }) => t("commands.visualize"),
    keywords: ["chart", "diagram", "graph", "visual", "widget", "Diagramm", "Grafik", "visualisieren"],
    hint: ({ t }) => t("commands.visualize_hint"),
    toggled: ({ visualize }) => visualize,
    run: ({ draft_key }) => toggle_draft_chip(draft_key, visualize_chip),
  },
];
