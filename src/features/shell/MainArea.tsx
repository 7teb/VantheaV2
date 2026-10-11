import { useLayoutEffect, useRef } from "react";
import { ChatSlot } from "../chat/ChatSlot.tsx";
import { ComposerSlot } from "../composer/ComposerSlot.tsx";
import { ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { Hero } from "./Hero.tsx";
import "./MainArea.css";

export const MainArea = () => {
  const chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const project_path = use_store(ui_store, (state) => state.project_path);
  const main = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const docked = chat_id !== null;

  useLayoutEffect(() => {
    const main_node = main.current;
    const dock_node = dock.current;
    if (!main_node || !dock_node) {
      return;
    }
    const observer = new ResizeObserver(() => main_node.style.setProperty("--composer-dock-height", `${dock_node.offsetHeight}px`));
    observer.observe(dock_node);
    return () => {
      observer.disconnect();
      main_node.style.removeProperty("--composer-dock-height");
    };
  }, [docked]);

  if (chat_id === null) {
    return (
      <main ref={main} className="main-area is-empty">
        <div className="empty-state">
          <Hero />
          <div className="content-column">
            <ComposerSlot chat_id={null} project_path={project_path} placement="hero" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main ref={main} className="main-area">
      <ChatSlot key={chat_id} chat_id={chat_id} />
      <div ref={dock} className="composer-dock">
        <div className="content-column">
          <ComposerSlot chat_id={chat_id} project_path={project_path} placement="docked" />
        </div>
      </div>
    </main>
  );
};
