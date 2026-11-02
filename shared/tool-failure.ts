export type ToolFailure =
  | { kind: "not_in_project"; path: string }
  | { kind: "replace_not_found"; path: string }
  | { kind: "outside_project"; path: string }
  | { kind: "web_no_key" }
  | { kind: "web_timeout"; seconds: number }
  | { kind: "web_unreadable" }
  | { kind: "agent_not_running"; name: string }
  | { kind: "reply"; text: string };
