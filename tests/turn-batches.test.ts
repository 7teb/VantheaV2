import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tool } from "../electron/tools/types.ts";
import { tool_batches } from "../electron/turn/batches.ts";
import { make_tool } from "./turn-loop-harness.ts";

const run: Tool["execute"] = async () => ({ status: "done", text: "", view: null });

const concurrent: Tool = { ...make_tool("read", run), concurrent: true };

const sequential = make_tool("write", run);

const call = (id: string, tool: Tool | null) => ({ id, tool });

const ids = (batches: { id: string }[][]) => batches.map((batch) => batch.map((entry) => entry.id));

test("only consecutive concurrent calls share a batch and the call order stays", () => {
  assert.deepEqual(ids(tool_batches([call("a", concurrent), call("b", concurrent), call("c", sequential), call("d", concurrent)])), [["a", "b"], ["c"], ["d"]]);
  assert.deepEqual(ids(tool_batches([call("a", sequential), call("b", sequential)])), [["a"], ["b"]]);
  assert.deepEqual(ids(tool_batches([call("a", concurrent), call("b", concurrent), call("c", concurrent)])), [["a", "b", "c"]]);
  assert.deepEqual(ids(tool_batches([])), []);
});

test("an unknown tool between concurrent calls splits them and stays alone", () => {
  assert.deepEqual(ids(tool_batches([call("a", concurrent), call("x", null), call("b", concurrent)])), [["a"], ["x"], ["b"]]);
  assert.deepEqual(ids(tool_batches([call("x", null), call("y", null)])), [["x"], ["y"]]);
});

test("a tool without the flag is sequential", () => {
  assert.equal(sequential.concurrent, undefined);
  assert.deepEqual(ids(tool_batches([call("a", sequential), call("b", concurrent), call("c", { ...concurrent, concurrent: false })])), [["a"], ["b"], ["c"]]);
});
