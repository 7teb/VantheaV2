import type { MessageKey } from "../../i18n/translate.ts";

export type PaneId = "personalization" | "web_search" | "image_gen" | "mcp" | "skills";

export type PaneSearch = { label: MessageKey; keywords: MessageKey[] };

export const pane_search: Record<PaneId, PaneSearch> = {
  personalization: {
    label: "settings.tab_personalization",
    keywords: [
      "personalization.personality",
      "personalization.pragmatic",
      "personalization.friendly",
      "personalization.cynical",
      "personalization.instructions",
      "personalization.memory",
      "personalization.mem_enable",
      "personalization.mem_exclude",
      "personalization.mem_reset",
      "personalization.mem_review",
      "personalization.mem_saved",
    ],
  },
  web_search: {
    label: "settings.tab_web_search",
    keywords: ["web.enable", "web.key", "web.results", "web.depth", "web.topic", "web.topic_news"],
  },
  image_gen: {
    label: "settings.tab_image_gen",
    keywords: ["image.enable", "image.model", "image.quality"],
  },
  mcp: {
    label: "settings.tab_mcp",
    keywords: ["mcp.add", "mcp.tools", "mcp.reconnect", "mcp.trust_dangerous", "mcp.log", "mcp.choose_plugin", "mcp.tier_dangerous"],
  },
  skills: {
    label: "settings.tab_skills",
    keywords: ["skills.folder", "skills.open", "skills.view", "skills.remove"],
  },
};
