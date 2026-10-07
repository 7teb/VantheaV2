import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { DockSlot } from "../docks/DockSlot.tsx";
import { use_t } from "../../i18n/index.ts";
import { clamp_dock_width, dock_min_width, max_dock_width, set_dock_width, ui_store, type DockKind } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import "./DockHost.css";

type Drag = { pointer_id: number; start_x: number; start_width: number };

const key_step_px = 24;

export const DockHost = () => {
  const t = use_t();
  const kind = use_store(ui_store, (state) => state.dock.kind);
  const width = use_store(ui_store, (state) => state.dock.width);
  const chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const project_path = use_store(ui_store, (state) => state.project_path);
  const host = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const [shown, set_shown] = useState<DockKind | null>(kind);
  const [resizing, set_resizing] = useState(false);

  if (kind !== null && kind !== shown) {
    set_shown(kind);
  }

  const on_pointer_down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer_id: event.pointerId, start_x: event.clientX, start_width: width };
    set_resizing(true);
  };

  const on_pointer_move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer_id !== event.pointerId || !host.current) {
      return;
    }
    host.current.style.setProperty("--dock-width", `${clamp_dock_width(current.start_width + current.start_x - event.clientX)}px`);
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer_id !== event.pointerId) {
      return;
    }
    drag.current = null;
    set_resizing(false);
    host.current?.style.removeProperty("--dock-width");
    set_dock_width(current.start_width + current.start_x - event.clientX);
  };

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    set_dock_width(width + (event.key === "ArrowLeft" ? key_step_px : -key_step_px));
  };

  return (
    <aside
      ref={host}
      className="dock-host"
      data-state={kind === null ? "closed" : "open"}
      data-resizing={resizing}
      inert={kind === null}
      style={{ "--dock-target": `${width}px` } as CSSProperties}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && kind === null) {
          set_shown(null);
        }
      }}
    >
      <div
        className="dock-resize"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t("shell.dock_resize")}
        aria-valuenow={width}
        aria-valuemin={dock_min_width}
        aria-valuemax={max_dock_width()}
        onKeyDown={on_key_down}
        onPointerDown={on_pointer_down}
        onPointerMove={on_pointer_move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="dock-inner">{shown && <DockSlot kind={shown} chat_id={chat_id} project_path={project_path} />}</div>
    </aside>
  );
};
