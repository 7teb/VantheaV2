import { useEffect, useMemo } from "react";
import { files_store } from "../../../../state/files.ts";
import { close_history, git_history_store, history_of, load_history, open_history } from "../../../../state/git-history.ts";
import { git_store, git_ui_of, shown_root } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";
import { CommitDetailPane, CommitDetailSkeleton } from "./CommitDetail.tsx";
import { HistoryList, HistorySkeleton } from "./HistoryList.tsx";
import { use_shown_git } from "./use-shown-git.ts";
import "./History.css";

const skeleton_widths = [74, 58, 82, 66, 90, 52, 70, 62];

type HistoryViewProps = { live: boolean; measure: (node: HTMLDivElement | null) => (() => void) | undefined };

export const HistoryView = ({ live, measure }: HistoryViewProps) => {
  const view = use_shown_git();
  const root = use_store(files_store, shown_root);
  const key = use_store(files_store, (state) => state.key);
  const stored = use_store(git_store, (state) => git_ui_of(state, key).commit);
  const readable = use_store(git_store, (state) => root !== null && state.readable === root);
  const list = use_store(git_history_store, (state) => history_of(state, root));
  const fingerprint = view.kind === "repo" ? view.fingerprint : null;
  const listed = list?.fingerprint ?? null;

  useEffect(() => {
    if (live && readable && root !== null && fingerprint !== null && listed !== fingerprint) {
      void load_history(root, fingerprint);
    }
  }, [live, readable, root, fingerprint, listed]);

  useEffect(() => {
    open_history();
    return close_history;
  }, []);

  const kept = useMemo(() => stored !== null && (list?.rows.some((row) => row.hash === stored) ?? false), [list?.rows, stored]);

  if (view.kind !== "repo" || root === null || !list) {
    return (
      <div className="git-history-split" ref={measure} aria-busy="true">
        <div className="git-history">
          <HistorySkeleton widths={skeleton_widths} />
        </div>
        <CommitDetailSkeleton />
      </div>
    );
  }
  const selected = kept ? stored : view.head;
  return (
    <div className="git-history-split" ref={measure}>
      <HistoryList root={root} chat_key={key} view={view} list={list} selected={selected} active={live && readable} />
      {selected !== null && <CommitDetailPane key={selected} root={root} hash={selected} live={live} />}
    </div>
  );
};
