import assert from "node:assert/strict";
import { test } from "node:test";
import { ask_user_result, ask_user_tool } from "../electron/tools/meta/ask-user.ts";
import { meta_tools } from "../electron/tools/meta/index.ts";
import { ToolArgumentError, type ToolContext } from "../electron/tools/types.ts";

const ctx = { signal: new AbortController().signal } as ToolContext;

const ask = (questions: unknown) => ask_user_tool.execute(ctx, { questions });

test("ask_user returns at once with the fixed text and the questions view", async () => {
  const result = await ask([
    { title: "  Which   test runner\nshould the new tests use? ", options: [" node --test ", "vitest"] },
    { title: "Anything else to keep in mind?" },
  ]);
  assert.equal(result.status, "done");
  assert.equal(
    result.text,
    'Shown to the user above the message box. This call does not wait: keep working on what does not depend on the answer and say which assumption you continue with. If the user answers, the answer arrives later as a user message starting with "Answer to your question". A dismissed question sends nothing.',
  );
  assert.equal(result.text, ask_user_result);
  assert.deepEqual(result.view, {
    kind: "questions",
    questions: [
      { title: "Which test runner should the new tests use?", options: ["node --test", "vitest"] },
      { title: "Anything else to keep in mind?", options: [] },
    ],
  });
});

test("ask_user rejects malformed questions with the exact messages", async () => {
  const rejects = (questions: unknown, message: string) => assert.rejects(async () => ask(questions), (error: unknown) => error instanceof ToolArgumentError && error.message === message);
  await rejects(undefined, "questions must be a list of 1 to 3 questions");
  await rejects([], "questions must be a list of 1 to 3 questions");
  await rejects([{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }], "questions must be a list of 1 to 3 questions");
  await rejects(["plain"], "questions[0] must be an object with a title and optional options");
  await rejects([{ title: "a" }, [{ title: "b" }]], "questions[1] must be an object with a title and optional options");
  await rejects([{ title: "   " }], "questions[0].title must be a non-empty string of at most 600 characters");
  await rejects([{ title: "x".repeat(601) }], "questions[0].title must be a non-empty string of at most 600 characters");
  await rejects([{ title: 7 }], "questions[0].title must be a non-empty string of at most 600 characters");
  await rejects([{ title: "a", options: [] }], "questions[0].options must be a list of 1 to 6 answers");
  await rejects([{ title: "a", options: "yes" }], "questions[0].options must be a list of 1 to 6 answers");
  await rejects([{ title: "a", options: ["1", "2", "3", "4", "5", "6", "7"] }], "questions[0].options must be a list of 1 to 6 answers");
  await rejects([{ title: "a" }, { title: "b", options: ["ok", " "] }], "questions[1].options[1] must be a non-empty string of at most 200 characters");
  await rejects([{ title: "a", options: ["y".repeat(201)] }], "questions[0].options[0] must be a non-empty string of at most 200 characters");
  await rejects([{ title: "a", options: [3] }], "questions[0].options[0] must be a non-empty string of at most 200 characters");
});

test("ask_user is offered to the main agent and plan mode, never to sub-agents", () => {
  assert.deepEqual(ask_user_tool.profiles, ["main", "plan"]);
  assert.equal(meta_tools.includes(ask_user_tool), true);
  assert.equal(ask_user_tool.available({} as Parameters<typeof ask_user_tool.available>[0], {} as Parameters<typeof ask_user_tool.available>[1]), true);
  assert.equal(ask_user_tool.spec.name, "ask_user");
  assert.deepEqual(Object.keys(ask_user_tool.spec.parameters.properties), ["questions"]);
});
