import { ComposerStrip } from "./ComposerStrip.tsx";
import { QueuedList } from "./QueuedList.tsx";
import "./ComposerTab.css";

type ComposerTabProps = { chat_id: string | null; project_path: string; draft_key: string };

export const ComposerTab = ({ chat_id, project_path, draft_key }: ComposerTabProps) => (
  <div className="composer-tab raised-surface enter-fade-up">
    {chat_id !== null && <QueuedList key={`queued:${chat_id}`} chat_id={chat_id} />}
    <ComposerStrip chat_id={chat_id} project_path={project_path} draft_key={draft_key} />
  </div>
);
