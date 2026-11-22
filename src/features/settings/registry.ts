import type { ComponentType } from "react";
import { BookOpenIcon, GlobeIcon, HookIcon, ImageIcon, PlugIcon, ShieldCheckIcon, SlidersIcon, SmileIcon, type IconComponent } from "../../components/icons.tsx";
import type { MessageKey } from "../../i18n/translate.ts";
import { GeneralPane } from "./GeneralPane.tsx";
import { pane_search } from "./pane-keywords.ts";
import { HooksAddAction, HooksPane } from "./panes/HooksPane.tsx";
import { ImagePane } from "./panes/ImagePane.tsx";
import { McpAddAction, McpPane } from "./panes/McpPane.tsx";
import { PersonalizationPane } from "./panes/PersonalizationPane.tsx";
import { PrivacyPane } from "./panes/PrivacyPane.tsx";
import { SkillsPane } from "./panes/SkillsPane.tsx";
import { WebSearchPane } from "./panes/WebSearchPane.tsx";
import type { SearchableSection } from "./settings-search.ts";

export type SettingsGroupId = "app" | "integrations";

export type SettingsSection = SearchableSection & { group: SettingsGroupId; icon: IconComponent; Pane: ComponentType; Action?: ComponentType };

export const settings_groups: { id: SettingsGroupId; label: MessageKey }[] = [
  { id: "app", label: "settings.group_app" },
  { id: "integrations", label: "settings.group_integrations" },
];

export const settings_sections: SettingsSection[] = [
  {
    id: "general",
    group: "app",
    label: "settings.tab_general",
    icon: SlidersIcon,
    keywords: [
      "settings.language",
      "settings.language_sub",
      "billing.title",
      "billing.mode",
      "billing.mode_api",
      "billing.mode_plan",
      "billing.continue",
      "billing.claude_mode",
      "billing.claude_login",
      "billing.mode_claude_plan",
      "settings.api_key",
      "settings.api_key_sub",
      "settings.balance",
      "settings.appearance",
      "settings.accent",
    ],
    Pane: GeneralPane,
  },
  { id: "personalization", group: "app", icon: SmileIcon, Pane: PersonalizationPane, ...pane_search.personalization },
  { id: "privacy", group: "app", icon: ShieldCheckIcon, Pane: PrivacyPane, ...pane_search.privacy },
  { id: "web_search", group: "integrations", icon: GlobeIcon, Pane: WebSearchPane, ...pane_search.web_search },
  { id: "image_gen", group: "integrations", icon: ImageIcon, Pane: ImagePane, ...pane_search.image_gen },
  { id: "mcp", group: "integrations", icon: PlugIcon, Pane: McpPane, Action: McpAddAction, ...pane_search.mcp },
  { id: "hooks", group: "integrations", icon: HookIcon, Pane: HooksPane, Action: HooksAddAction, ...pane_search.hooks },
  { id: "skills", group: "integrations", icon: BookOpenIcon, Pane: SkillsPane, ...pane_search.skills },
];
