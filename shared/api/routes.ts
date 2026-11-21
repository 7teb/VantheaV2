import type { EventName } from "../ipc/index.ts";
import type { ApiEvent } from "./contract.ts";

export const api_routes = [
  { id: "info", method: "GET", path: "/v1/info", summary: "Server name, version, API version and the defaults a prompt falls back to" },
  { id: "models", method: "GET", path: "/v1/models", summary: "Models a session can use, with their reasoning efforts" },
  { id: "account.get", method: "GET", path: "/v1/account", summary: "Billing mode and the ChatGPT account of the data dir" },
  { id: "account.billing", method: "POST", path: "/v1/account/billing", summary: "Switch model billing between API pricing and the ChatGPT plan" },
  { id: "account.sign_in", method: "POST", path: "/v1/account/chatgpt/sign_in", summary: "Open the ChatGPT sign-in in the system browser of the host; the result arrives as account.changed" },
  { id: "account.sign_out", method: "POST", path: "/v1/account/chatgpt/sign_out", summary: "Sign out of ChatGPT and revoke the stored refresh token" },
  { id: "sessions.list", method: "GET", path: "/v1/sessions", summary: "All sessions of the data dir" },
  { id: "sessions.create", method: "POST", path: "/v1/sessions", summary: "Create a session in an absolute, existing directory" },
  { id: "sessions.get", method: "GET", path: "/v1/sessions/:id", summary: "One session with all messages and question states" },
  { id: "sessions.remove", method: "DELETE", path: "/v1/sessions/:id", summary: "Delete a session" },
  { id: "prompt", method: "POST", path: "/v1/sessions/:id/prompt", summary: "Start a run with a prompt; 409 while a turn is active" },
  { id: "run.get", method: "GET", path: "/v1/sessions/:id/runs/:run_id", summary: "Run result; wait=idle or wait=turn holds the response until it is settled" },
  { id: "stop", method: "POST", path: "/v1/sessions/:id/stop", summary: "Stop the running turn" },
  { id: "steer", method: "POST", path: "/v1/sessions/:id/steer", summary: "Send a message into the running turn" },
  { id: "approvals.list", method: "GET", path: "/v1/sessions/:id/approvals", summary: "Pending approvals of the main turn and its agents" },
  { id: "approvals.reply", method: "POST", path: "/v1/sessions/:id/approvals/:approval_id", summary: "Approve or deny a pending approval" },
  { id: "approvals.hold", method: "POST", path: "/v1/sessions/:id/approvals/:approval_id/hold", summary: "Hold a pending approval" },
  { id: "questions.list", method: "GET", path: "/v1/sessions/:id/questions", summary: "Open questions the model asked" },
  { id: "questions.reply", method: "POST", path: "/v1/sessions/:id/questions", summary: "Answer or dismiss open questions; 202 when the answer started a new run" },
  { id: "plan.accept", method: "POST", path: "/v1/sessions/:id/plan/accept", summary: "Accept a presented plan and start a run that implements it" },
  { id: "diff", method: "GET", path: "/v1/sessions/:id/diff", summary: "Changed files of the session, or one file diff with path=" },
  { id: "attachments.upload", method: "POST", path: "/v1/attachments", summary: "Upload raw bytes as an attachment; name in x-vx-name, URI-encoded" },
  { id: "events", method: "GET", path: "/v1/events", summary: "Server-sent events; session= filters, last= or Last-Event-ID resumes" },
  { id: "shutdown", method: "POST", path: "/v1/shutdown", summary: "Quit the headless instance" },
] as const;

type Route = (typeof api_routes)[number];

export type RouteId = Route["id"];

type PathParam<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParam<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

type RouteParams<Id extends RouteId> = Record<PathParam<Extract<Route, { id: Id }>["path"]>, string>;

const routes_by_id = Object.fromEntries(api_routes.map((route) => [route.id, route])) as Record<RouteId, Route>;

export const route_path = <Id extends RouteId>(id: Id, params: RouteParams<Id>): string => {
  const values: Record<string, string> = params;
  return routes_by_id[id].path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? encodeURIComponent(values[segment.slice(1)]) : segment))
    .join("/");
};

export const event_names = {
  "turn:event": "turn.event",
  "chats:appended": "session.appended",
  "chats:changed": "session.updated",
  "chats:removed": "session.deleted",
  "questions:changed": "questions.changed",
  "agent:event": "agent.event",
  "agents:changed": "agents.changed",
  "agents:approvals_changed": "agent.approvals_changed",
  "background:changed": "background.changed",
  "chatgpt:changed": "account.changed",
} as const satisfies Partial<Record<EventName, ApiEvent["type"]>>;

export const api_event_types = [
  "hello",
  "ping",
  "resync",
  "turn.event",
  "session.appended",
  "session.updated",
  "session.deleted",
  "questions.changed",
  "agent.event",
  "agents.changed",
  "agent.approvals_changed",
  "background.changed",
  "account.changed",
  "run.settled",
] as const satisfies readonly ApiEvent["type"][];
