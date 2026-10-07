import type { Todo } from "./chat.ts";

export type DiffLine = { kind: "context" | "add" | "remove" | "gap"; text: string; old_line: number | null; new_line: number | null };

export type GrepMatch = { path: string; line: number; text: string };

export type OutlineSymbol = { kind: string; name: string; line: number; depth: number };

export type WebSource = { title: string; url: string; snippet: string };

export type GeneratedImage = { id: string; width: number | null; height: number | null };

export type ToolView =
  | { kind: "files"; root: string; files: string[]; directories: number; truncated: boolean }
  | { kind: "read"; path: string; start_line: number; end_line: number; total_lines: number; truncated: boolean }
  | { kind: "grep"; query: string; matches: GrepMatch[]; total: number; truncated: boolean }
  | { kind: "outline"; path: string; symbols: OutlineSymbol[] }
  | { kind: "edit"; path: string; created: boolean; added: number; removed: number; diff: DiffLine[] }
  | {
      kind: "command";
      command: string;
      cwd: string;
      exit_code: number | null;
      output: string;
      timed_out: boolean;
      duration_ms: number;
    }
  | { kind: "background"; task_id: string; command: string; status: string; output_tail: string }
  | { kind: "agent"; agent_id: string; run_id: string; name: string; status: string; report: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "plan"; text: string }
  | { kind: "web_search"; query: string; depth: "basic" | "advanced"; answer: string; sources: WebSource[] }
  | { kind: "image"; prompt: string; images: GeneratedImage[] }
  | { kind: "browser"; action: string; url: string; title: string; detail: string }
  | { kind: "mcp"; server: string; tool: string; text: string; is_error: boolean }
  | { kind: "memory"; action: "remember" | "forget" | "list"; text: string }
  | { kind: "skill"; action: "read" | "install"; name: string }
  | { kind: "text"; text: string };

export type ToolViewKind = ToolView["kind"];
