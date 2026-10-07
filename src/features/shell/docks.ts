import { BotIcon, GitBranchPlusIcon, GlobeIcon, ImageIcon, SquareTerminalIcon, type IconComponent } from "../../components/icons.tsx";
import type { MessageKey } from "../../i18n/translate.ts";
import type { DockKind } from "../../state/ui.ts";

export type DockToggle = { label: MessageKey; icon: IconComponent };

export const dock_toggles: Record<DockKind, DockToggle> = {
  terminal: { label: "terminal.open", icon: SquareTerminalIcon },
  browser: { label: "browser.open", icon: GlobeIcon },
  background: { label: "background.title", icon: GitBranchPlusIcon },
  agents: { label: "agent.title", icon: BotIcon },
  artifacts: { label: "docks.artifacts_title", icon: ImageIcon },
};

export const dock_kinds = Object.keys(dock_toggles) as DockKind[];
