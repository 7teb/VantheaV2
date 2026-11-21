import { remote_client } from "../../api/bridge.ts";
import { FolderIcon, GlobeIcon, ImageIcon, LayersIcon, SquareTerminalIcon, type IconComponent } from "../../components/icons.tsx";
import type { MessageKey } from "../../i18n/translate.ts";
import { close_agent_run } from "../../state/agents.ts";
import { toggle_dock, ui_store, type DockKind } from "../../state/ui.ts";
import type { ShortcutId } from "./shortcuts.ts";

export type DockToggle = { label: MessageKey; icon: IconComponent; shortcut: ShortcutId | null };

export const dock_toggles: Record<DockKind, DockToggle> = {
  terminal: { label: "terminal.open", icon: SquareTerminalIcon, shortcut: "toggle_terminal" },
  browser: { label: "browser.open", icon: GlobeIcon, shortcut: "toggle_browser" },
  background: { label: "background.title", icon: LayersIcon, shortcut: "toggle_tasks" },
  artifacts: { label: "docks.artifacts_title", icon: ImageIcon, shortcut: null },
  files: { label: "files.open", icon: FolderIcon, shortcut: "toggle_files" },
};

export const titlebar_docks: DockKind[] = remote_client ? ["terminal", "files"] : ["terminal", "browser", "files"];

export const toggle_background_dock = () => {
  if (ui_store.get().dock.kind !== "background") {
    close_agent_run();
  }
  toggle_dock("background");
};
