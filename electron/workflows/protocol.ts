export type ScriptRef = { name: string } | { script_path: string };

export type AgentDraft = { kind: "agent"; prompt: string; opts: Record<string, unknown> };

export type WorkflowDraft = { kind: "workflow"; ref: ScriptRef; args: unknown; has_args: boolean };

export type NoteCall =
  | { kind: "phase"; title: string }
  | { kind: "log"; text: string }
  | { kind: "caught"; where: string; text: string }
  | { kind: "done"; value_json: string }
  | { kind: "failed"; message: string };

export type HookDraft = AgentDraft | WorkflowDraft | NoteCall;

export type HookCall = (AgentDraft & { id: number; scope: number | null }) | (WorkflowDraft & { id: number }) | NoteCall;

export type HostMessage =
  | { type: "start"; source: string; filename: string; args_text: string }
  | { type: "settle"; seq: number; id: number; ok: boolean; text: string }
  | { type: "child"; seq: number; id: number; source: string; filename: string; name: string; args_text: string };

export type WorkerMessage =
  | { type: "compiled" }
  | { type: "compile_failed"; message: string }
  | { type: "batch"; ack: number; items: HookCall[] }
  | { type: "broken"; message: string };

export const sandbox_stack = { worker_mb: 64, script_bytes: 1024 * 1024 };

export const agent_option_keys = ["label", "phase", "schema", "role", "model", "effort", "isolation"];
