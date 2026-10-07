import { Button } from "../../components/Button.tsx";
import { BotIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_agent_run } from "../../state/agents.ts";
import type { BodyProps } from "./body-types.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { format_duration } from "./tool-summary.ts";

export const CommandBody = ({ view }: BodyProps<"command">) => {
  const t = use_t();
  const failed = view.timed_out || (view.exit_code !== null && view.exit_code !== 0);
  return (
    <div className="tool-body-stack">
      <pre className="tool-command inset-surface">
        <span className="tool-command-prompt">{"$ "}</span>
        {view.command}
      </pre>
      <div className="tool-body-line tool-body-muted">
        <span className="tool-body-mono">{view.cwd}</span>
        {view.exit_code !== null && <span>{t("tools.exit_code", { n: view.exit_code })}</span>}
        {view.timed_out && <span>{t("tools.timed_out")}</span>}
        {view.duration_ms > 0 && <span>{format_duration(view.duration_ms)}</span>}
      </div>
      {view.output ? <OutputBlock text={view.output} tone={failed ? "error" : "normal"} /> : <div className="tool-body-muted">{t("tools.no_output")}</div>}
    </div>
  );
};

export const BackgroundBody = ({ view }: BodyProps<"background">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      {view.command && (
        <pre className="tool-command inset-surface">
          <span className="tool-command-prompt">{"$ "}</span>
          {view.command}
        </pre>
      )}
      <div className="tool-body-line tool-body-muted">
        <span className="tool-body-mono">{view.task_id}</span>
        <span>{view.status}</span>
      </div>
      {view.output_tail ? <OutputBlock text={view.output_tail} /> : <div className="tool-body-muted">{t("tools.no_output")}</div>}
    </div>
  );
};

export const AgentBody = ({ view }: BodyProps<"agent">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      <div className="tool-body-line">
        <span>{view.name}</span>
        <span className="tool-body-muted">{view.status}</span>
      </div>
      {view.report ? (
        <div className="tool-body-quote">
          <Markdown text={view.report} className="tool-body-markdown" />
        </div>
      ) : (
        <div className="tool-body-muted">{t("tools.no_report")}</div>
      )}
      <div className="tool-body-line">
        <Button variant="secondary" icon={<BotIcon size={14} />} onClick={() => open_agent_run({ agent_id: view.agent_id, run_id: view.run_id })}>
          {t("agent.view_transcript")}
        </Button>
      </div>
    </div>
  );
};
