import type { DiffLine } from "../../../shared/tool-view.ts";
import { use_t } from "../../i18n/index.ts";
import { DiffView } from "./DiffView.tsx";
import type { BodyProps } from "./body-types.ts";
import "./CommandCard.css";
import "./bodies-files.css";

const max_listed = 200;

export const FilesBody = ({ view }: BodyProps<"files">) => {
  const t = use_t();
  const shown = view.files.slice(0, max_listed);
  return (
    <div className="tool-body-stack">
      <ul className="tool-body-list tool-card">
        {shown.map((file) => (
          <li key={file} className="tool-body-path">
            {file}
          </li>
        ))}
      </ul>
      {(view.truncated || view.files.length > shown.length) && <div className="tool-body-muted">{t("tools.list_truncated")}</div>}
    </div>
  );
};

export const GrepBody = ({ view }: BodyProps<"grep">) => (
  <ul className="tool-body-list tool-card">
    {view.matches.map((match, index) => (
      <li key={index} className="tool-grep-match">
        <span className="tool-body-path tool-body-muted">
          {match.path}:{match.line}
        </span>
        <span className="tool-body-mono">{match.text.trim()}</span>
      </li>
    ))}
  </ul>
);

export const OutlineBody = ({ view }: BodyProps<"outline">) => (
  <div className="tool-body-stack">
    <div className="tool-body-path">{view.path}</div>
    <ul className="tool-body-list tool-card">
      {view.symbols.map((symbol, index) => (
        <li key={index} className="tool-outline-symbol" style={{ paddingLeft: 12 + symbol.depth * 14 }}>
          <span className="tool-body-muted">{symbol.kind}</span>
          <span className="tool-body-mono">{symbol.name}</span>
          <span className="tool-body-muted tool-outline-line">{symbol.line}</span>
        </li>
      ))}
    </ul>
  </div>
);

export const ReadBody = ({ view }: BodyProps<"read">) => {
  const t = use_t();
  const text = view.content ?? "";
  const numbers = text
    .split("\n")
    .map((_, index) => view.start_line + index)
    .join("\n");
  const whole = view.start_line === 1 && view.end_line === view.total_lines;
  return (
    <div className="command-card read-card">
      <div className="command-card-shell" data-kind="path">
        {view.path}
      </div>
      <div className="read-card-code" tabIndex={0}>
        <pre className="read-card-gutter" aria-hidden="true">
          {numbers}
        </pre>
        <pre className="read-card-text">{text}</pre>
      </div>
      <div className="command-card-footer">
        <span>{whole ? t("tools.read_lines_all", { n: view.total_lines }) : t("tools.read_lines", { from: view.start_line, to: view.end_line, total: view.total_lines })}</span>
      </div>
    </div>
  );
};

type EditCardProps ={ path: string; created: boolean; added: number; removed: number; diff: DiffLine[] };

export const EditCard = ({ path, created, added, removed, diff }: EditCardProps) => {
  const t = use_t();
  return (
    <div className="edit-card">
      <div className="edit-card-head">
        <span className="tool-body-path">{path}</span>
        {created && <span className="tool-body-muted">{t("tools.created_file")}</span>}
        <span className="tool-stat-add">+{added}</span>
        <span className="tool-stat-remove">-{removed}</span>
      </div>
      <DiffView lines={diff} />
    </div>
  );
};

export const EditBody = ({ view }: BodyProps<"edit">) => <EditCard {...view} />;
