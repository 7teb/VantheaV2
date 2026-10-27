import { useMemo, useState } from "react";
import type { DiffEntry } from "../../../../../shared/turn-diff.ts";
import { Segmented } from "../../../../components/Segmented.tsx";
import { VirtualRows } from "../../../../components/VirtualRows.tsx";
import { use_language, use_t, type Translate } from "../../../../i18n/index.ts";
import { set_diff_range, type DiffRange } from "../../../../state/turn-diff-ui.ts";
import { DockEmpty } from "../../DockPanel.tsx";
import { ChangeCounts, ChangesSkeleton } from "../git/ChangesList.tsx";
import { ViewerNote } from "../git/ViewerDiff.tsx";
import { clock_label, full_clock_label, short_clock_label, totals } from "./diff-rows.ts";
import { note_texts, type ReadySummary } from "./turn-diff-notes.ts";
import { TurnDiffRow } from "./TurnDiffRow.tsx";
import type { TurnDiffModel } from "./use-turn-diff.ts";

const row_height = 26;

type Clock = (iso: string) => string;

type OpenEntry = (entry: DiffEntry) => void;

type HeadTime = { text: string; title: string };

const head_iso = (model: TurnDiffModel): string | null => {
  if (model.range === "turn") {
    return model.started_at;
  }
  const summary = model.load?.value;
  return summary?.kind === "ready" ? summary.base_at : null;
};

const head_time = (t: Translate, model: TurnDiffModel, language: string): HeadTime | null => {
  const iso = head_iso(model);
  if (iso === null) {
    return null;
  }
  const text = short_clock_label(language, iso, new Date());
  const title = full_clock_label(language, iso);
  return model.range === "turn" ? { text, title } : { text: t("turn_diff.since", { time: text }), title: t("turn_diff.since", { time: title }) };
};

type ReadyListProps = { summary: ReadySummary; range: DiffRange; selected: DiffEntry | null; clock: Clock; on_open: OpenEntry };

const ReadyList = ({ summary, range, selected, clock, on_open }: ReadyListProps) => {
  const t = use_t();
  const [scroller, set_scroller] = useState<HTMLDivElement | null>(null);
  const notes = note_texts(t, summary, clock);
  const sums = useMemo(() => totals(summary.entries), [summary.entries]);
  const count = summary.entries.length;
  return (
    <div className="git-list turn-diff-scroll" ref={set_scroller}>
      {count > 0 && (
        <div className="turn-diff-count">
          <span>{count === 1 ? t("turn_diff.count_one") : t("turn_diff.count", { n: count })}</span>
          <ChangeCounts added={sums.added} removed={sums.removed} />
        </div>
      )}
      {notes.map((text, index) => (
        <ViewerNote key={`${index}:${text}`} text={text} />
      ))}
      {count === 0 ? (
        <DockEmpty text={range === "chat" ? t("turn_diff.empty_chat") : t("turn_diff.empty_turn")} />
      ) : (
        <VirtualRows
          items={summary.entries}
          row_height={row_height}
          scroller={scroller}
          render={(entry) => <TurnDiffRow key={`${entry.status}:${entry.path}`} entry={entry} active={entry === selected} on_open={on_open} />}
        />
      )}
    </div>
  );
};

type ListBodyProps = { model: TurnDiffModel; clock: Clock; on_open: OpenEntry };

const ListBody = ({ model, clock, on_open }: ListBodyProps) => {
  const t = use_t();
  const summary = model.load?.value ?? null;
  if (summary === null) {
    return model.load?.status === "failed" ? <DockEmpty text={t("git.diff_failed")} /> : <ChangesSkeleton />;
  }
  if (summary.kind === "none") {
    return <DockEmpty text={model.range === "chat" ? t("turn_diff.none_chat") : t("turn_diff.none")} />;
  }
  if (summary.kind === "failed") {
    return <DockEmpty text={t("turn_diff.failed", { error: summary.error })} />;
  }
  return <ReadyList summary={summary} range={model.range} selected={model.selected} clock={clock} on_open={on_open} />;
};

type TurnDiffListProps = { model: TurnDiffModel; on_open: OpenEntry };

export const TurnDiffList = ({ model, on_open }: TurnDiffListProps) => {
  const t = use_t();
  const language = use_language();
  const clock: Clock = (iso) => clock_label(language, iso, new Date());
  const time = head_time(t, model, language);
  return (
    <div className="files-tree turn-diff-list">
      <div className="turn-diff-head">
        <Segmented
          className="turn-diff-range"
          size="sm"
          fit
          label={t("turn_diff.range_label")}
          value={model.range}
          on_change={set_diff_range}
          options={[
            { id: "turn", label: t("turn_diff.range_turn") },
            { id: "chat", label: t("turn_diff.range_chat") },
          ]}
        />
        {time && (
          <span className="turn-diff-time" title={time.title}>
            {time.text}
          </span>
        )}
      </div>
      <ListBody model={model} clock={clock} on_open={on_open} />
    </div>
  );
};
