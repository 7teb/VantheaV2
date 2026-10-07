import { draft_key } from "../../state/chat-drafts.ts";
import { Composer } from "./Composer.tsx";
import { QueuedList } from "./QueuedList.tsx";
import { TodosPanel } from "./TodosPanel.tsx";
import "./ComposerParts.css";
import "./ComposerSlot.css";

export type ComposerSlotProps = { chat_id: string | null; project_path: string; placement: "hero" | "docked" };

export const ComposerSlot = ({ chat_id, project_path, placement }: ComposerSlotProps) => (
  <div className="composer-slot" data-placement={placement}>
    {chat_id !== null && <TodosPanel chat_id={chat_id} />}
    {chat_id !== null && <QueuedList chat_id={chat_id} />}
    <Composer chat_id={chat_id} project_path={project_path} draft_key={draft_key(chat_id, project_path)} placement={placement} />
  </div>
);
