import { useState } from "react";
import { drop_leaving, shown_rows, track_leaving, type LeavingRow } from "./leaving-rows.ts";

type Tracked<T> = { items: T[]; leaving: LeavingRow<T>[] };

export const use_leaving_rows = <T extends { id: string }>(items: T[]) => {
  const [tracked, set_tracked] = useState<Tracked<T>>({ items, leaving: [] });
  let current = tracked;
  if (tracked.items !== items) {
    current = { items, leaving: track_leaving(tracked.items, items, tracked.leaving) };
    set_tracked(current);
  }
  const finish = (id: string) => set_tracked((state) => ({ ...state, leaving: drop_leaving(state.leaving, id) }));
  return { rows: shown_rows(items, current.leaving), finish };
};
