import type { ToolStep } from "../../../shared/chat.ts";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import type { BodyProps } from "./body-types.ts";
import { CommandText } from "./CommandCard.tsx";
import { OutputBlock } from "./OutputBlock.tsx";

export const PlanBody = ({ view }: BodyProps<"plan">) => <Markdown text={view.text} className="tool-body-markdown" />;

export const MemoryBody = ({ view }: BodyProps<"memory">) => <div className="tool-body-quote">{view.text}</div>;

export const TextBody = ({ view }: BodyProps<"text">) => <OutputBlock text={view.text} />;

export const PeerMessageBody = ({ view }: BodyProps<"peer_message">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      <div className="tool-body-muted">{[t(`agent.peer_type_${view.type}`), t("agent.peer_about", { x: view.about }), view.message_id].filter(Boolean).join(" · ")}</div>
      <div className="tool-body-quote">{view.summary}</div>
    </div>
  );
};

const call_arguments = (step: ToolStep): string => {
  const args = step.name === "call_mcp_tool" ? step.args.arguments : step.args;
  if (typeof args === "string") {
    return args.trim();
  }
  return args && typeof args === "object" && Object.keys(args).length > 0 ? JSON.stringify(args) : "";
};

export const McpBody = ({ view, step }: BodyProps<"mcp">) => {
  const args = call_arguments(step);
  if (!args) {
    return <OutputBlock text={view.text} />;
  }
  return (
    <div className="command-card mcp-card">
      <CommandText command={args} prompt={false} />
      <OutputBlock text={view.text} />
    </div>
  );
};
