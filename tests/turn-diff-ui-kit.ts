import type { AssistantMessage, Message, Step, UserMessage } from "../shared/chat.ts";
import type { DiffEntry, DiffNote, DiffSummary } from "../shared/turn-diff.ts";

export const diff_entry = (path: string, status: DiffEntry["status"] = "modified", extra: Partial<DiffEntry> = {}): DiffEntry => ({
  path,
  orig_path: null,
  status,
  added: status === "submodule" ? null : 3,
  removed: status === "submodule" ? null : 1,
  binary: false,
  commits: null,
  ...extra,
});

export const ready = (entries: DiffEntry[], extra: Partial<Extract<DiffSummary, { kind: "ready" }>> = {}): Extract<DiffSummary, { kind: "ready" }> => ({
  kind: "ready",
  source: "git",
  base_at: "2026-10-26T14:02:00.000Z",
  end: { kind: "snapshot", at: "2026-10-26T14:05:00.000Z" },
  entries,
  notes: [] as DiffNote[],
  ...extra,
});

export const user_message = (id: string, origin: UserMessage["origin"] = "user"): UserMessage => ({
  id,
  role: "user",
  text: "",
  attachments: [],
  origin,
  created_at: "2026-10-26T10:00:00.000Z",
});

export const assistant_message = (id: string, steps: Step[] = [], created_at = "2026-10-26T10:00:00.000Z"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at,
  ended_at: "2026-10-26T10:01:00.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

export const manual_compaction = (id: string): AssistantMessage => assistant_message(id, [{ id: "c", round: 0, kind: "compaction", source: "manual", status: "done" }]);

export const edit_step = (id: string, path: string, added: number, removed: number): Step => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call_${id}`,
  name: "edit_file",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: { kind: "edit", path, added, removed, created: false, diff: [] },
  error: null,
  result_text: "ok",
  started_at: 1,
  ended_at: 2,
});

export const messages_fixture = (): Message[] => [
  user_message("u1"),
  assistant_message("a1"),
  user_message("r1", "agent_update"),
  assistant_message("a2"),
  user_message("r2", "agent_report"),
  assistant_message("a3"),
  user_message("b1", "background"),
  assistant_message("a4"),
  user_message("u2"),
  manual_compaction("k1"),
  user_message("u3"),
  assistant_message("a5"),
  assistant_message("a6"),
];
