import assert from "node:assert/strict";
import { test } from "node:test";
import { by_id_source } from "../electron/browser/eval-world.ts";
import { evaluate_safely } from "../electron/browser/evaluate.ts";
import type { BrowserTab } from "../electron/browser/state.ts";

type Sent = { method: string; params: Record<string, unknown> };

type Answer = (method: string, params: Record<string, unknown>) => unknown;

const refusal = {
  result: { type: "object", subtype: "error" },
  exceptionDetails: {
    exceptionId: 1,
    text: "Uncaught",
    lineNumber: 0,
    columnNumber: 0,
    exception: { type: "object", subtype: "error", className: "EvalError", description: "EvalError: Possible side-effect in debug-evaluate" },
  },
};

const page_params = (expression: string) => ({ expression, objectGroup: "vx-eval", generatePreview: true, throwOnSideEffect: true, timeout: 10000, silent: true });

const world_answers =
  (isolated_result: (params: Record<string, unknown>) => unknown): Answer =>
  (method, params) => {
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "frame-1", url: "https://e.com/" } } };
    }

    if (method === "Page.createIsolatedWorld") {
      return { executionContextId: 7 };
    }

    if (method !== "Runtime.evaluate") {
      return {};
    }

    if (params.contextId === undefined) {
      return refusal;
    }

    if (params.expression === by_id_source) {
      return { result: { type: "undefined" } };
    }

    return isolated_result(params);
  };

const eval_tab = (answer: Answer) => {
  const sent: Sent[] = [];
  const guest = {
    debugger: {
      isAttached: () => true,
      sendCommand: async (method: string, params: Record<string, unknown>) => {
        sent.push({ method, params });
        return answer(method, params);
      },
    },
  };
  return { sent, tab: { tab_id: "t", debugger_attached: true, guest } as unknown as BrowserTab };
};

const signal = () => new AbortController().signal;

test("a side-effect refusal in the page context is retried once in a prepared isolated world of the main frame", async () => {
  const { sent, tab } = eval_tab(world_answers(() => ({ result: { type: "string", value: "x" } })));
  const expression = "document.getElementById('out').textContent";
  assert.deepEqual(await evaluate_safely(tab, expression, signal()), { thrown: false, kind: "string", text: "x", isolated: true });
  assert.deepEqual(sent, [
    { method: "Runtime.evaluate", params: page_params(expression) },
    { method: "Page.getFrameTree", params: {} },
    { method: "Page.createIsolatedWorld", params: { frameId: "frame-1", worldName: "vx-eval" } },
    { method: "Runtime.evaluate", params: { expression: by_id_source, contextId: 7, silent: true, returnByValue: true } },
    { method: "Runtime.evaluate", params: { ...page_params(expression), contextId: 7 } },
    { method: "Runtime.releaseObjectGroup", params: { objectGroup: "vx-eval" } },
  ]);
});

test("a second refusal reports the page refusal, a throw in the isolated world reports the throw as isolated", async () => {
  const twice = eval_tab(world_answers(() => refusal));
  const refused = await evaluate_safely(twice.tab, "document.body.remove()", signal());
  assert.equal(refused.thrown, true);
  assert.equal(refused.kind, "side effect");
  assert.equal(refused.isolated, false);
  assert.match(refused.text, /^Uncaught EvalError: Possible side-effect in debug-evaluate\nbrowser_eval runs only side-effect-free JavaScript/);
  assert.equal(twice.sent.at(-1)?.method, "Runtime.releaseObjectGroup");
  const throws = eval_tab(
    world_answers(() => ({ exceptionDetails: { text: "Uncaught", exception: { type: "object", subtype: "error", description: "TypeError: Cannot read properties of null (reading 'value')" } } })),
  );
  assert.deepEqual(await evaluate_safely(throws.tab, "document.getElementById('missing').value", signal()), {
    thrown: true,
    kind: "threw",
    text: "Uncaught TypeError: Cannot read properties of null (reading 'value')",
    isolated: true,
  });
});

test("when the isolated world cannot be prepared the page refusal stands and the objects are still released", async (t) => {
  t.mock.method(console, "warn", () => {});
  const no_frame = eval_tab((method, params) => {
    if (method === "Page.getFrameTree") {
      return { frameTree: {} };
    }

    return method === "Runtime.evaluate" && params.contextId === undefined ? refusal : {};
  });
  const stands = await evaluate_safely(no_frame.tab, "document.getElementById('out')", signal());
  assert.equal(stands.kind, "side effect");
  assert.equal(stands.isolated, false);
  assert.deepEqual(
    no_frame.sent.map((entry) => entry.method),
    ["Runtime.evaluate", "Page.getFrameTree", "Runtime.releaseObjectGroup"],
  );
  const broken_patch = eval_tab((method, params) => {
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "frame-1" } } };
    }

    if (method === "Page.createIsolatedWorld") {
      return { executionContextId: 7 };
    }

    if (method === "Runtime.evaluate" && params.contextId === 7) {
      return { exceptionDetails: { text: "Uncaught", exception: { type: "object", subtype: "error", description: "ReferenceError: Document is not defined" } } };
    }

    return method === "Runtime.evaluate" ? refusal : {};
  });
  const still_refused = await evaluate_safely(broken_patch.tab, "document.getElementById('out')", signal());
  assert.equal(still_refused.kind, "side effect");
  assert.equal(still_refused.isolated, false);
  assert.equal(broken_patch.sent.at(-1)?.method, "Runtime.releaseObjectGroup");
});

test("an accepted page evaluation never creates an isolated world", async () => {
  const { sent, tab } = eval_tab((method) => (method === "Runtime.evaluate" ? { result: { type: "number", value: 2, description: "2" } } : {}));
  assert.deepEqual(await evaluate_safely(tab, "document.links.length", signal()), { thrown: false, kind: "number", text: "2", isolated: false });
  assert.deepEqual(
    sent.map((entry) => entry.method),
    ["Runtime.evaluate", "Runtime.releaseObjectGroup"],
  );
});
