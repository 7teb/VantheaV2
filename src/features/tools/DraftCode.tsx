import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { use_t } from "../../i18n/index.ts";
import type { LiveDraft } from "./live-draft.ts";
import "./DiffView.css";
import "./bodies-files.css";

const follow_slack_px = 24;
const chunk_rows = 32;

type RowKind = "add" | "remove";

type DraftRowProps = { kind: RowKind; number: number | null; text: string };

const DraftRow = ({ kind, number, text }: DraftRowProps) => (
  <div className="diff-row" data-kind={kind}>
    <span className="diff-gutter" />
    <span className="diff-gutter">{number ?? ""}</span>
    <span className="diff-sign">{kind === "add" ? "+" : "-"}</span>
    <span className="diff-code">{text || " "}</span>
  </div>
);

type Line = { kind: RowKind; text: string };

type DraftChunkProps = { first: number; numbered: boolean; lines: Line[] };

const same_chunk = (left: DraftChunkProps, right: DraftChunkProps) =>
  left.first === right.first &&
  left.numbered === right.numbered &&
  left.lines.length === right.lines.length &&
  left.lines.every((line, index) => line.kind === right.lines[index].kind && line.text === right.lines[index].text);

const DraftChunk = memo(
  ({ first, numbered, lines }: DraftChunkProps) => (
    <div className="draft-chunk">
      {lines.map((line, index) => (
        <DraftRow key={index} kind={line.kind} number={numbered ? first + index + 1 : null} text={line.text} />
      ))}
    </div>
  ),
  same_chunk,
);

const split_lines = (text: string | null, writing: boolean): string[] => {
  const lines = text ? text.split(/\r?\n/) : [];
  if (!writing && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
};

const use_follow = (rows: number, writing: boolean) => {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(writing);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && writing && pinned.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [rows, writing]);
  const on_scroll = () => {
    const node = scroller.current;
    if (node) {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight <= follow_slack_px;
    }
  };
  return { scroller, on_scroll };
};

export const DraftCode = ({ draft }: { draft: LiveDraft }) => {
  const t = use_t();
  const added = useMemo(() => split_lines(draft.text, draft.writing), [draft.text, draft.writing]);
  const removed = useMemo(() => split_lines(draft.old_text, draft.writing), [draft.old_text, draft.writing]);
  const lines = useMemo(
    (): Line[] => [...removed.map((text) => ({ kind: "remove" as const, text })), ...added.map((text) => ({ kind: "add" as const, text }))],
    [removed, added],
  );
  const { scroller, on_scroll } = use_follow(lines.length, draft.writing);
  const chunks = [];
  for (let at = 0; at < lines.length; at += chunk_rows) {
    chunks.push(<DraftChunk key={at} first={at} numbered={draft.whole_file} lines={lines.slice(at, at + chunk_rows)} />);
  }
  return (
    <div className="edit-card">
      <div className="edit-card-head">
        <span className="tool-body-path">{draft.path || t("tools.live_editing_generic")}</span>
        {draft.writing && <span className="tool-body-muted">{t("tools.live_writing")}</span>}
        {added.length > 0 && <span className="tool-body-muted">{t(added.length === 1 ? "tools.live_lines_one" : "tools.live_lines_other", { n: added.length })}</span>}
      </div>
      <div ref={scroller} className="diff-view inset-surface" onScroll={on_scroll}>
        {chunks}
      </div>
    </div>
  );
};
