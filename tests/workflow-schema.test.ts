import assert from "node:assert/strict";
import { test } from "node:test";
import { check_schema, validate_result } from "../electron/workflows/schema.ts";

const findings = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { file: { type: "string", pattern: "^src/" }, line: { type: "integer", minimum: 1 }, severity: { enum: ["low", "high"] } },
        required: ["file", "line"],
        additionalProperties: false,
      },
    },
    note: { type: ["string", "null"] },
  },
  required: ["findings"],
};

test("supported schemas pass the check", () => {
  assert.equal(check_schema(findings), null);
  assert.equal(check_schema({ type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "number" }] }, b: { oneOf: [{ const: 1 }, { const: 2 }] }, c: { allOf: [{ type: "integer" }] } } }), null);
  assert.equal(check_schema({ type: "object", properties: {}, additionalProperties: { type: "string" } }), null);
});

test("unsupported and unsatisfiable schemas are rejected before an agent starts", () => {
  const cases: [unknown, RegExp][] = [
    [null, /JSON Schema object/],
    [{ type: "array", items: {} }, /root must be/],
    [{ type: "object" }, /root must be/],
    [{ type: "object", properties: { a: { type: "string" } }, required: ["b"] }, /required names b/],
    [{ type: "object", properties: { a: { $ref: "#/x" } } }, /uses \$ref/],
    [{ type: "object", properties: { a: { type: "date" } } }, /type must be one of/],
    [{ type: "object", properties: { a: { enum: [] } } }, /empty enum/],
    [{ type: "object", properties: { a: { type: "array", minItems: 3, maxItems: 1 } } }, /minItems is larger/],
    [{ type: "object", properties: { a: { type: "string", minLength: 5, maxLength: 2 } } }, /minLength is larger/],
    [{ type: "object", properties: { a: { type: "number", minimum: 5, maximum: 2 } } }, /minimum is larger/],
    [{ type: "object", properties: { a: { type: "string", pattern: "(" } } }, /not a valid regular expression/],
    [{ type: "object", properties: { a: { type: "object", properties: {}, required: ["x"], additionalProperties: false } } }, /no value can satisfy/],
    [{ type: "object", properties: { a: { anyOf: [] } } }, /anyOf must be a non-empty array/],
    [{ type: "object", properties: { a: { type: "array", minItems: -1 } } }, /non-negative integer/],
  ];
  for (const [schema, pattern] of cases) {
    const problem = check_schema(schema);
    assert.ok(problem && pattern.test(problem), `${JSON.stringify(schema)}: ${problem}`);
  }
});

test("validation reports every mismatch with a JSON pointer", () => {
  assert.deepEqual(validate_result(findings, { findings: [{ file: "src/a.ts", line: 3, severity: "high" }], note: null }), []);
  const errors = validate_result(findings, { findings: [{ file: "lib/a.ts", line: 0, severity: "mid", extra: 1 }, { line: 2.5 }], note: 4 });
  assert.deepEqual(errors, [
    "/findings/0/file must match the pattern ^src/",
    "/findings/0/line must be at least 1",
    '/findings/0/severity must be one of "low", "high"',
    "/findings/0 has the property extra, which the schema does not allow",
    "/findings/1 is missing the required property file",
    "/findings/1/line must be integer, got number",
    "/note must be string or null, got integer",
  ]);
  assert.deepEqual(validate_result(findings, { findings: [] }), ["/findings must have at least 1 items"]);
  assert.deepEqual(validate_result(findings, {}), ["the result is missing the required property findings"]);
  assert.deepEqual(validate_result({ type: "object", properties: { n: { type: "number" } } }, { n: 3 }), []);
  assert.deepEqual(validate_result({ type: "object", properties: { v: { oneOf: [{ type: "integer" }, { type: "number" }] } } }, { v: 2 }), ["/v must match exactly one oneOf alternative, it matches 2"]);
  assert.deepEqual(validate_result({ type: "object", properties: { v: { anyOf: [{ type: "string" }, { type: "boolean" }] } } }, { v: 2 }), ["/v matches none of the anyOf alternatives"]);
  assert.deepEqual(validate_result({ type: "object", properties: {}, additionalProperties: { type: "string" } }, { a: "x", b: 1 }), ["/b must be string, got integer"]);
});
