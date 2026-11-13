import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_t } from "../../i18n/index.ts";
import { tool_icon } from "./registry.tsx";
import { RowDetail } from "./RowMeta.tsx";
import { is_active_status, read_urls, tool_label, web_query } from "./tool-meta.ts";
import { WebSources } from "./WebSources.tsx";
import "./WebSearchRow.css";

export const shows_web_row = (step: ToolStep) => step.name === "web_search" && (step.status === "running" || step.status === "done");

type WebSearchRowProps = { chat_id: string; step: ToolStep };

export const WebSearchRow = ({ chat_id, step }: WebSearchRowProps) => {
  const t = use_t();
  const Icon = tool_icon(step);
  const view = step.view?.kind === "web_search" ? step.view : null;
  const working = is_active_status(step.status) && step.status !== "queued";
  const query = read_urls(step).length > 0 ? "" : web_query(step);
  const label = query ? t(working ? "tool_label.web_search" : "web.searched_web") : tool_label(t, step);
  const settled = step.status === "done" && view && (view.sources.length > 0 || (view.failed?.length ?? 0) > 0 || view.answer !== "") ? view : null;
  return (
    <div className="tool-row web-row" data-status={step.status}>
      <div className="web-row-head" title={query || undefined}>
        <span className="tool-row-icon">
          <Icon plain />
        </span>
        <span className={class_names("tool-row-label", working && "is-working")}>
          <LabelMorph morph_key={`${working}:${label}`}>
            <WorkingLetters text={label} active={working} />
          </LabelMorph>
        </span>
        {query && <span className="web-row-query">{query}</span>}
        <span className="tool-row-meta">
          <RowDetail chat_id={chat_id} step={step} />
        </span>
      </div>
      {settled && <WebSources view={settled} />}
    </div>
  );
};
