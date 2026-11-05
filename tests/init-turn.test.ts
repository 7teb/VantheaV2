import assert from "node:assert/strict";
import { test } from "node:test";
import { command_origins, human_origin, instruction_origin, type AssistantMessage, type Message, type Step, type ToolStep, type UserMessage, type UserOrigin } from "../shared/chat.ts";
import { channel_kind } from "../shared/ipc/index.ts";
import type { ModelEntry } from "../shared/models.ts";
import { open_questions } from "../shared/questions.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { clear_authorization, human_requests_of, set_authorization } from "../electron/permissions/context.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { git_init_request_text } from "../electron/turn/git-init-request.ts";
import { init_request_text } from "../electron/turn/init-request.ts";
import { review_request_text } from "../electron/turn/review-request.ts";
import { counted_image } from "../electron/turn/user-input.ts";

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1_000_000, max_output: 4096, reasoning_passback: false };

const user = (id: string, text: string, origin: UserOrigin = "user"): UserMessage => ({ id, role: "user", text, origin, attachments: [], created_at: "2026-10-15T10:00:00.000Z" });

const assistant = (id: string, steps: Step[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: "2026-10-15T10:00:01.000Z",
  ended_at: "2026-10-15T10:00:05.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const asked: ToolStep = {
  id: "q1",
  round: 0,
  kind: "tool",
  index: 0,
  call_id: "q1",
  name: "ask_questions",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: { kind: "questions", questions: [{ title: "Which package manager?", options: ["npm", "pnpm"] }] },
  error: null,
  result_text: "",
  started_at: 1,
  ended_at: 2,
};

test("the init request asks for AGENTS.md with commands, layout, conventions and gotchas and nothing invented", () => {
  const lines = init_request_text.split("\n");
  assert.match(lines[0] ?? "", /create AGENTS\.md in the project root, or update it if it already exists/);
  for (const topic of [/^- Commands: .*build.*test.*single test/, /^- Layout: /, /^- Conventions /, /^- Gotchas: /]) {
    assert.ok(lines.some((line) => topic.test(line)), `missing ${topic}`);
  }
  assert.match(init_request_text, /never invent a command/);
  assert.match(init_request_text, /keep the rules and instructions a person wrote there/);
  assert.match(init_request_text, /Change no other file\./);
  assert.doesNotMatch(init_request_text, /[–—]/);
});

test("the gitinit request asks name, visibility and collaborators through ask_user before it creates anything", () => {
  const lines = git_init_request_text.split("\n");
  assert.match(lines[1] ?? "", /^First call ask_user once with these three questions, then end your turn and wait for the answers\./);
  assert.match(git_init_request_text, /1\. The repository name/);
  assert.match(git_init_request_text, /2\. Private or public, with Private as the first option/);
  assert.match(git_init_request_text, /3\. Whether to invite collaborators, with Nobody as the first option/);
  assert.match(git_init_request_text, /gh auth status/);
  assert.match(git_init_request_text, /gh repo create <name> --private \(or --public\) --source \. --remote origin --push/);
  assert.match(git_init_request_text, /gh api --method PUT repos\/<owner>\/<name>\/collaborators\/<username>/);
  assert.match(git_init_request_text, /\.env files and keys/);
  assert.doesNotMatch(git_init_request_text, /[–—]/);
});

test("init and git_init are human origins like user, plan_accept and undo, and the automatic origins are not", () => {
  const human: UserOrigin[] = ["user", "plan_accept", "undo", "init", "git_init"];
  const automatic: UserOrigin[] = ["continue", "background", "agent_report", "agent_update"];
  assert.deepEqual(human.filter(human_origin), human);
  assert.deepEqual(automatic.filter(human_origin), []);
});

test("an init request counts as a human message for the permission review", () => {
  const chat_id = "init-context";
  set_authorization(chat_id, [user("u1", "Look at the repo."), assistant("a1", []), user("u2", init_request_text, "init")]);
  assert.deepEqual(
    human_requests_of(chat_id).map((entry) => entry.text),
    ["Look at the repo.", init_request_text],
  );
  clear_authorization(chat_id);
});

test("an init request closes the questions of earlier turns", () => {
  const before: Message[] = [user("u1", "set up the project"), assistant("a1", [asked])];
  assert.equal(open_questions(before, {}).length, 1);
  assert.equal(open_questions([...before, user("u2", init_request_text, "init")], {}).length, 0);
});

test("an init request is replayed to the model as the user's instruction", async () => {
  const messages: Message[] = [user("u1", "hi"), assistant("a1", [{ id: "t", round: 0, kind: "text", text: "hello" }]), user("u2", init_request_text, "init")];
  const out = await build_api_messages({ system: "", summary: null, messages, model, agent_tools: true }, counted_image);
  const last = out.at(-1) as ApiMessage;
  assert.equal(last.role, "user");
  assert.equal(last.role === "user" && last.instruction, true);
});

test("turn:init is a declared invoke channel", () => {
  assert.equal(channel_kind("turn:init"), "invoke");
});

test("review is a command origin and a human origin, so it counts as the user's own request", () => {
  assert.deepEqual(command_origins, ["init", "git_init", "review"]);
  assert.equal(human_origin("review"), true);
  assert.equal(instruction_origin("review"), true);
});

test("a review request is the user's instruction for the permission review and for the model", async () => {
  const chat_id = "review-context";
  const text = review_request_text("42", model);
  set_authorization(chat_id, [user("u1", "Look at the repo."), assistant("a1", []), { ...user("u2", text, "review"), command_arg: "42" }]);
  assert.deepEqual(
    human_requests_of(chat_id).map((entry) => entry.text),
    ["Look at the repo.", text],
  );
  clear_authorization(chat_id);
  const out = await build_api_messages({ system: "", summary: null, messages: [user("u1", "hi"), { ...user("u2", text, "review"), command_arg: "42" }], model, agent_tools: true }, counted_image);
  const last = out.at(-1) as ApiMessage;
  assert.equal(last.role === "user" && last.instruction, true);
});
