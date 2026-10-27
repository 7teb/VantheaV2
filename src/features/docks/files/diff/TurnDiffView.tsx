import { useEffect, useRef } from "react";
import { scope_key, type DiffEntry } from "../../../../../shared/turn-diff.ts";
import { files_store, set_tree_open, shown_view } from "../../../../state/files.ts";
import { select_diff_path } from "../../../../state/turn-diff-ui.ts";
import { reload_live } from "../../../../state/turn-diff.ts";
import { use_store } from "../../../../state/use-store.ts";
import { TurnDiffList } from "./TurnDiffList.tsx";
import { TurnDiffViewer } from "./TurnDiffViewer.tsx";
import type { TurnDiffModel } from "./use-turn-diff.ts";
import "./TurnDiff.css";

type TurnDiffViewProps = {
  chat_id: string;
  model: TurnDiffModel;
  live: boolean;
  narrow: boolean;
  measure: (node: HTMLDivElement | null) => (() => void) | undefined;
};

export const TurnDiffView = ({ chat_id, model, live, narrow, measure }: TurnDiffViewProps) => {
  const tree_open = use_store(files_store, (state) => shown_view(state).tree_open);
  const path = model.selected?.path ?? null;
  const shown_scope = model.scope === null ? null : scope_key(model.scope);
  const opened = useRef<{ path: string | null; narrow: boolean }>({ path: null, narrow: false });

  useEffect(() => {
    const before = opened.current;
    opened.current = { path, narrow };
    if (narrow && path !== null && (path !== before.path || !before.narrow)) {
      set_tree_open(false);
    }
  }, [path, narrow]);

  useEffect(() => {
    if (live) {
      reload_live(chat_id);
    }
  }, [live, chat_id, shown_scope]);

  const open = (entry: DiffEntry) => {
    select_diff_path(entry.path);
    if (narrow) {
      set_tree_open(false);
    }
  };

  const viewer = model.selected !== null && model.scope !== null;
  return (
    <div className="files-split" ref={measure} data-surface="diff" data-tree={tree_open || !viewer} data-viewer={viewer}>
      <TurnDiffList model={model} on_open={open} />
      {viewer && model.selected && model.scope && (
        <TurnDiffViewer key={`${shown_scope}\n${model.selected.path}`} chat_id={chat_id} scope={model.scope} entry={model.selected} live={live} />
      )}
    </div>
  );
};
