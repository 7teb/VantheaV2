import { ChatSlot } from "../chat/ChatSlot.tsx";
import { ComposerSlot } from "../composer/ComposerSlot.tsx";
import { ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { Hero } from "./Hero.tsx";
import "./MainArea.css";

export const MainArea = () => {
  const chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const project_path = use_store(ui_store, (state) => state.project_path);

  if (chat_id === null) {
    return (
      <main className="main-area is-empty">
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
    <main className="main-area">
      <ChatSlot key={chat_id} chat_id={chat_id} />
      <div className="composer-dock">
        <div className="content-column">
          <ComposerSlot chat_id={chat_id} project_path={project_path} placement="docked" />
        </div>
      </div>
    </main>
  );
};
