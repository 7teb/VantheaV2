import type { Step } from "../../../shared/chat.ts";
import { file_changes } from "../../../shared/file-changes.ts";
import type { DiffSummary } from "../../../shared/turn-diff.ts";

export type CardRow = { path: string; added: number; removed: number; created: boolean; deleted: boolean; binary: boolean; submodule: boolean };

export type CardChanges = { source: "snapshot" | "edits"; rows: CardRow[] };

export const card_changes = (summary: DiffSummary | null, steps: Step[]): CardChanges => {
  if (summary?.kind === "ready" && summary.source === "git" && summary.entries.length > 0) {
    return {
      source: "snapshot",
      rows: summary.entries.map((entry) => ({
        path: entry.path,
        added: entry.added ?? 0,
        removed: entry.removed ?? 0,
        created: entry.status === "added",
        deleted: entry.status === "deleted",
        binary: entry.binary,
        submodule: entry.status === "submodule",
      })),
    };
  }
  return { source: "edits", rows: file_changes(steps).map((change) => ({ ...change, deleted: false, binary: false, submodule: false })) };
};
