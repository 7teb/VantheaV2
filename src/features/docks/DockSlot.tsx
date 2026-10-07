import { useState, type ComponentType } from "react";
import { ui_store, type DockKind } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { AgentsDock } from "./agents/AgentsDock.tsx";
import { ArtifactsDock } from "./artifacts/ArtifactsDock.tsx";
import { BackgroundDock } from "./background/BackgroundDock.tsx";
import { BrowserDock } from "./browser/BrowserDock.tsx";
import type { DockViewProps } from "./dock-view.ts";
import { TerminalDock } from "./terminal/TerminalDock.tsx";
import "./DockSlot.css";

export type DockSlotProps = { kind: DockKind; chat_id: string | null; project_path: string };

const dock_views: Record<DockKind, ComponentType<DockViewProps>> = {
  terminal: TerminalDock,
  browser: BrowserDock,
  background: BackgroundDock,
  agents: AgentsDock,
  artifacts: ArtifactsDock,
};

export const DockSlot = ({ kind, chat_id, project_path }: DockSlotProps) => {
  const open_kind = use_store(ui_store, (state) => state.dock.kind);
  const [mounted, set_mounted] = useState<DockKind[]>([kind]);

  if (!mounted.includes(kind)) {
    set_mounted([...mounted, kind]);
  }

  return (
    <div className="dock-slot">
      {mounted.map((entry) => {
        const DockView = dock_views[entry];
        const shown = entry === kind;
        return (
          <div key={entry} className="dock-layer" data-shown={shown} inert={!shown}>
            <DockView visible={entry === open_kind} chat_id={chat_id} project_path={project_path} />
          </div>
        );
      })}
    </div>
  );
};
