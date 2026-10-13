import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import type { BodyProps } from "./body-types.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { TodoList } from "./TodoList.tsx";

export const TodosBody = ({ view }: BodyProps<"todos">) => <TodoList todos={view.todos} />;

export const PlanBody = ({ view }: BodyProps<"plan">) => <Markdown text={view.text} className="tool-body-markdown" />;

export const MemoryBody = ({ view }: BodyProps<"memory">) => <div className="tool-body-quote">{view.text}</div>;

export const TextBody = ({ view }: BodyProps<"text">) => <OutputBlock text={view.text} />;

export const QuestionsBody = ({ view }: BodyProps<"questions">) => (
  <div className="tool-body-stack">
    {view.questions.map((question, index) => (
      <div key={index} className="tool-body-stack">
        <div>{question.title}</div>
        {question.options.length > 0 && (
          <ol className="tool-body-quote">
            {question.options.map((option, at) => (
              <li key={at}>{`${at + 1}. ${option}`}</li>
            ))}
          </ol>
        )}
      </div>
    ))}
  </div>
);

export const PeerMessageBody = ({ view }: BodyProps<"peer_message">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      <div className="tool-body-muted">{[t(`agent.peer_type_${view.type}`), t("agent.peer_about", { x: view.about }), view.message_id].filter(Boolean).join(" · ")}</div>
      <div className="tool-body-quote">{view.summary}</div>
    </div>
  );
};

export const McpBody = ({ view }: BodyProps<"mcp">) => <OutputBlock text={view.text} tone={view.is_error ? "error" : "normal"} />;
