import { use_t } from "../../i18n/index.ts";
import { DiffView } from "./DiffView.tsx";
import type { BodyProps } from "./body-types.ts";

const max_listed = 200;

export const FilesBody = ({ view }: BodyProps<"files">) => {
  const t = use_t();
  const shown = view.files.slice(0, max_listed);
  return (
    <div className="tool-body-stack">
      <div className="tool-body-line">
        <span className="tool-body-mono">{view.root || "."}</span>
        <span className="tool-body-muted">{t("tools.files_summary", { n: view.files.length, d: view.directories })}</span>
      </div>
      {shown.length > 0 && (
        <ul className="tool-body-list inset-surface">
          {shown.map((file) => (
            <li key={file} className="tool-body-mono">
              {file}
            </li>
          ))}
        </ul>
      )}
      {(view.truncated || view.files.length > shown.length) && <div className="tool-body-muted">{t("tools.list_truncated")}</div>}
    </div>
  );
};

export const ReadBody = ({ view }: BodyProps<"read">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      <div className="tool-body-line">
        <span className="tool-body-mono">{view.path}</span>
        {view.end_line > 0 && (
          <span className="tool-body-muted">{t("tools.read_range", { start: view.start_line, end: view.end_line, total: view.total_lines })}</span>
        )}
      </div>
      {view.truncated && <div className="tool-body-muted">{t("tools.read_truncated")}</div>}
    </div>
  );
};

export const GrepBody = ({ view }: BodyProps<"grep">) => {
  const t = use_t();
  if (view.matches.length === 0) {
    return <div className="tool-body-muted">{t("tools.grep_no_matches")}</div>;
  }
  return (
    <div className="tool-body-stack">
      <ul className="tool-body-list inset-surface">
        {view.matches.map((match, index) => (
          <li key={index} className="tool-grep-match">
            <span className="tool-body-mono tool-body-muted">
              {match.path}:{match.line}
            </span>
            <span className="tool-body-mono">{match.text.trim()}</span>
          </li>
        ))}
      </ul>
      {view.truncated && <div className="tool-body-muted">{t("tools.grep_capped", { n: view.total })}</div>}
    </div>
  );
};

export const OutlineBody = ({ view }: BodyProps<"outline">) => (
  <div className="tool-body-stack">
    <div className="tool-body-mono">{view.path}</div>
    <ul className="tool-body-list inset-surface">
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

export const EditBody = ({ view }: BodyProps<"edit">) => {
  const t = use_t();
  return (
    <div className="tool-body-stack">
      <div className="tool-body-line">
        <span className="tool-body-mono">{view.path}</span>
        {view.created && <span className="tool-body-muted">{t("tools.created_file")}</span>}
        <span className="tool-stat-add">+{view.added}</span>
        <span className="tool-stat-remove">-{view.removed}</span>
      </div>
      <DiffView lines={view.diff} />
    </div>
  );
};
