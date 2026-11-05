import assert from "node:assert/strict";
import { test } from "node:test";
import { require_boolean } from "../electron/storage/coerce.ts";

test("require_boolean passes booleans through", () => {
  assert.equal(require_boolean(true, "keep awake"), true);
  assert.equal(require_boolean(false, "keep awake"), false);
});

test("require_boolean rejects every non-boolean value with the label", () => {
  for (const value of ["true", 1, 0, null, undefined, {}, []]) {
    assert.throws(() => require_boolean(value, "keep awake"), /keep awake must be a boolean/);
  }
});
