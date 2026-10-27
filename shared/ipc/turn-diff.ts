import { emit, invoke } from "./channel.ts";
import type { GitFileDiff } from "../git-view.ts";
import type { DiffScope, DiffSummary, TurnDiffChange } from "../turn-diff.ts";

export const turn_diff_channels = {
  "turn_diff:summaries": invoke<[chat_id: string, scopes: DiffScope[]], DiffSummary[]>(),
  "turn_diff:file": invoke<[chat_id: string, scope: DiffScope, path: string], GitFileDiff>(),
  "turn_diff:changed": emit<TurnDiffChange>(),
} as const;
