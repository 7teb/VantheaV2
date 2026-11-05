import assert from "node:assert/strict";
import { test } from "node:test";
import { cell_count, context_cells, context_rows, share_text } from "../src/features/composer/context-cells.ts";

const count = (cells: string[], part: string) => cells.filter((cell) => cell === part).length;

test("the context grid gives each part its share of a hundred cells, at least one when it has tokens", () => {
  const cells = context_cells({ used: 52_000, limit: 200_000, parts: { system: 10_000, tools: 1_000, messages: 41_000 } });
  assert.equal(cells.length, cell_count);
  assert.equal(count(cells, "system"), 5);
  assert.equal(count(cells, "tools"), 1);
  assert.equal(count(cells, "messages"), 21);
  assert.equal(count(cells, "free"), 73);
  assert.deepEqual(cells.slice(0, 7), ["system", "system", "system", "system", "system", "tools", "messages"]);
});

test("old measurements without a split fill one used part, a full window and no measurement stay at a hundred cells", () => {
  assert.equal(count(context_cells({ used: 30_000, limit: 100_000 }), "used"), 30);
  assert.deepEqual(context_rows({ used: 30_000, limit: 100_000 }), [{ part: "used", tokens: 30_000 }]);
  assert.equal(count(context_cells({ used: 150_000, limit: 100_000 }), "used"), cell_count);
  assert.equal(count(context_cells(null), "free"), cell_count);
  assert.equal(count(context_cells({ used: 10, limit: 0 }), "free"), cell_count);
});

test("shares under ten percent keep one decimal", () => {
  assert.equal(share_text(1_200, 100_000), "1.2%");
  assert.equal(share_text(0, 100_000), "0%");
  assert.equal(share_text(52_000, 200_000), "26%");
});
