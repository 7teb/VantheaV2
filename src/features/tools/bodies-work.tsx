import type { MouseEvent } from "react";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_external } from "../../state/chat-actions.ts";
import type { BodyProps } from "./body-types.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { TodoList } from "./TodoList.tsx";

export const TodosBody = ({ view }: BodyProps<"todos">) => <TodoList todos={view.todos} />;

export const PlanBody = ({ view }: BodyProps<"plan">) => <Markdown text={view.text} className="tool-body-markdown" />;

export const MemoryBody = ({ view }: BodyProps<"memory">) => {
  const t = use_t();
  return view.text ? <div className="tool-body-quote">{view.text}</div> : <div className="tool-body-muted">{t("tools.memory_none")}</div>;
};

export const SkillBody = ({ view }: BodyProps<"skill">) => {
  const t = use_t();
  return (
    <div className="tool-body-line">
      <span className="tool-body-muted">{t(view.action === "install" ? "tools.skill_installed" : "tools.skill_read")}</span>
      <span>{view.name}</span>
    </div>
  );
};

export const TextBody = ({ view }: BodyProps<"text">) => <OutputBlock text={view.text} />;

export const McpBody = ({ view }: BodyProps<"mcp">) => (
  <div className="tool-body-stack">
    <div className="tool-body-line tool-body-muted">
      <span>{view.server}</span>
      <span className="tool-body-mono">{view.tool}</span>
    </div>
    <OutputBlock text={view.text} tone={view.is_error ? "error" : "normal"} />
  </div>
);

const follow = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
  event.preventDefault();
  open_external(url);
};

export const BrowserBody = ({ view }: BodyProps<"browser">) => (
  <div className="tool-body-stack">
    <div className="tool-body-line">
      <span className="tool-body-muted">{view.action}</span>
      {view.title && <span>{view.title}</span>}
    </div>
    {view.url && (
      <a className="tool-body-link tool-body-mono" href={view.url} onClick={(event) => follow(event, view.url)}>
        {view.url}
      </a>
    )}
    {view.detail && <div className="tool-body-muted">{view.detail}</div>}
  </div>
);
