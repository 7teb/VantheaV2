import { memo, useEffect, useLayoutEffect, useState } from "react";
import type { GitRepoView, GraphRow } from "../../../../../shared/git-view.ts";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_clock } from "../../../../components/use-clock.ts";
import { VirtualRows } from "../../../../components/VirtualRows.tsx";
import { use_t } from "../../../../i18n/index.ts";
import { relative_time } from "../../../../i18n/relative-time.ts";
import { load_more_history, type HistoryList as HistoryRows } from "../../../../state/git-history.ts";
import { git_store, git_ui_of, remember_history_top, select_commit } from "../../../../state/git.ts";
import { GraphCell, graph_row_height, graph_width } from "./GraphCell.tsx";
import { RefLabels } from "./RefLabels.tsx";
import { ViewerNote } from "./ViewerDiff.tsx";

const minute_ms = 60_000;

const prefetch_rows = 8;

type HistoryRowProps = { row: GraphRow; head: boolean; active: boolean; now: number };

const HistoryRow = memo(({ row, head, active, now }: HistoryRowProps) => {
  const t = use_t();
  return (
    <button type="button" className="git-commit" data-active={active} aria-current={active || undefined} onClick={() => select_commit(row.hash)}>
      <GraphCell row={row} head={head} />
      <RefLabels labels={row.labels} />
      <Tooltip label={row.subject} placement="bottom-start">
        <span className="git-commit-subject">{row.subject}</span>
      </Tooltip>
      <span className="git-commit-author">{row.author}</span>
      {row.time !== null && <span className="git-commit-time">{relative_time(t, new Date(row.time).toISOString(), now)}</span>}
    </button>
  );
});

export const HistorySkeleton = ({ widths }: { widths: number[] }) => (
  <>
    {widths.map((width, index) => (
      <div key={index} className="git-history-skeleton">
        <span className="git-history-dot">
          <Skeleton width={8} height={8} radius={4} />
        </span>
        <Skeleton width={`${width}%`} height={10} radius={4} />
      </div>
    ))}
  </>
);

type HistoryListProps = { root: string; chat_key: string; view: GitRepoView; list: HistoryRows; selected: string | null; active: boolean };

export const HistoryList = ({ root, chat_key, view, list, selected, active }: HistoryListProps) => {
  const t = use_t();
  const [scroller, set_scroller] = useState<HTMLDivElement | null>(null);
  const now = Math.floor(use_clock(true) / minute_ms) * minute_ms;
  const { rows } = list;
  const last = rows.at(-1);

  useLayoutEffect(() => {
    if (!scroller) {
      return;
    }
    let top = git_ui_of(git_store.get(), chat_key).history_top;
    scroller.scrollTop = top;
    const track = () => {
      top = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", track, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", track);
      remember_history_top(chat_key, top);
    };
  }, [scroller, chat_key]);

  useEffect(() => {
    if (!scroller || !active || list.done || list.status !== "ready") {
      return;
    }
    const check = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - prefetch_rows * graph_row_height) {
        void load_more_history(root);
      }
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    return () => scroller.removeEventListener("scroll", check);
  }, [scroller, active, root, list.done, list.status, rows.length]);

  return (
    <div className="git-history" ref={set_scroller} aria-busy={list.status === "loading_more"}>
      <VirtualRows
        items={rows}
        row_height={graph_row_height}
        scroller={scroller}
        render={(row) => <HistoryRow key={row.hash} row={row} head={row.hash === view.head} active={row.hash === selected} now={now} />}
      />
      {list.shallow_end && last && (
        <div className="git-history-end" style={{ paddingLeft: graph_width(last) + 6 }}>
          {t("git.history_end")}
        </div>
      )}
      {list.status === "loading_more" && <HistorySkeleton widths={[68, 54]} />}
      {list.status === "failed" && <ViewerNote text={t("git.history_failed")} />}
    </div>
  );
};
