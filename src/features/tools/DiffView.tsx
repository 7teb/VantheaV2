import { memo, useMemo } from "react";
import type { DiffLine } from "../../../shared/tool-view.ts";
import { VirtualRows } from "../../components/VirtualRows.tsx";
import { use_t } from "../../i18n/index.ts";
import "./DiffView.css";

const sign: Record<DiffLine["kind"], string> = { add: "+", remove: "-", context: "", gap: "" };

const tab_columns = 8;

const diff_row_height = 20;

const DiffRow = ({ line, gap_label }: { line: DiffLine; gap_label: string }) =>
  line.kind === "gap" ? (
    <div className="diff-gap">
      <span>{gap_label}</span>
    </div>
  ) : (
    <div className="diff-row" data-kind={line.kind}>
      <span className="diff-gutter">{line.old_line ?? ""}</span>
      <span className="diff-gutter">{line.new_line ?? ""}</span>
      <span className="diff-sign">{sign[line.kind]}</span>
      <span className="diff-code">{line.text || " "}</span>
    </div>
  );

const text_columns = (text: string): number => {
  let columns = 0;
  for (const char of text) {
    columns = char === "\t" ? columns + tab_columns - (columns % tab_columns) : columns + 1;
  }
  return columns;
};

export const DiffView = memo(({ lines }: { lines: DiffLine[] }) => {
  const t = use_t();
  if (lines.length === 0) {
    return <div className="diff-empty">{t("tools.diff_empty")}</div>;
  }
  return (
    <div className="diff-view inset-surface">
      {lines.map((line, index) => (
        <DiffRow key={index} line={line} gap_label={t("tools.diff_gap")} />
      ))}
    </div>
  );
});

type DiffRowsProps = { lines: DiffLine[]; scroller: HTMLElement | null };

export const DiffRows = memo(({ lines, scroller }: DiffRowsProps) => {
  const t = use_t();
  const widest = useMemo(() => lines.reduce((most, line) => Math.max(most, text_columns(line.text)), 0), [lines]);
  return (
    <VirtualRows
      className="diff-rows"
      style={{ minWidth: `calc(${widest}ch + var(--diff-rows-chrome))` }}
      items={lines}
      row_height={diff_row_height}
      scroller={scroller}
      render={(line, index) => <DiffRow key={index} line={line} gap_label={t("tools.diff_gap")} />}
    />
  );
});
