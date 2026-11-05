import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphEdge } from "../shared/git-view.ts";
import { empty_lanes, lay_out, type GraphCommit, type GraphPlace } from "../shared/git/graph.ts";

type Row = GraphCommit & GraphPlace;

const dag = (spec: string): GraphCommit[] =>
  spec
    .trim()
    .split("\n")
    .map((line) => {
      const [hash = "", parents = ""] = line.trim().split(":");
      return { hash, parents: parents.trim() === "" ? [] : parents.trim().split(" ") };
    });

const linear = dag(`
  c:b
  b:a
  a:
`);

const branch_and_merge = dag(`
  m:c f
  f:e
  c:b
  e:b
  b:a
  a:
`);

const octopus = dag(`
  o:a1 b1 c1
  c1:root
  b1:root
  a1:root
  root:
`);

const two_roots = dag(`
  m:x y
  y:y0
  x:x0
  y0:
  x0:
`);

const fork_without_merge = dag(`
  t2:t1
  s2:s1
  t1:base
  s1:base
  base:
`);

const criss_cross = dag(`
  top:m1 m2
  m2:b a
  m1:a b
  b:r
  a:r
  r:
`);

const all_dags = { linear, branch_and_merge, octopus, two_roots, fork_without_merge, criss_cross };

const lane_set = (edges: GraphEdge[], end: "from" | "to"): string[] => [...new Set(edges.map((edge) => `${edge[end]}:${edge.color}`))].sort();

const check_continuity = (rows: Row[]) => {
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const bottom = lane_set(rows[index].down, "to");
    const top = lane_set(rows[index + 1].up, "from");
    assert.deepEqual(top, bottom, `lanes leaving ${rows[index].hash} must enter ${rows[index + 1].hash}`);
  }
  assert.deepEqual(rows[0].up, [], "the first row has nothing above it");
  assert.deepEqual(rows.at(-1)?.down, [], "the last row leaves no lane open");
};

const check_parents = (rows: Row[]) => {
  const at = new Map(rows.map((row, index) => [row.hash, index]));
  for (const [index, row] of rows.entries()) {
    for (const parent of row.parents) {
      const target = at.get(parent);
      assert.ok(target !== undefined && target > index, `${parent} comes after its child ${row.hash}`);
      const edge = row.down.find((candidate) => candidate.from === row.col && follows(rows, index, candidate.to) === parent);
      assert.ok(edge, `an edge from ${row.hash} reaches its parent ${parent}`);
    }
  }
};

const follows = (rows: Row[], from_row: number, lane: number): string | null => {
  for (let index = from_row + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const entering = row.up.find((edge) => edge.from === lane);
    if (!entering) return null;
    if (entering.to === row.col) return row.hash;
    if (!row.down.some((edge) => edge.from === lane && edge.to === lane)) return null;
  }
  return null;
};

const check_widths = (rows: Row[]) => {
  for (const row of rows) {
    const above = row.up.length === 0 ? 0 : Math.max(...row.up.map((edge) => edge.from)) + 1;
    const below = row.down.length === 0 ? 0 : Math.max(...row.down.map((edge) => edge.to)) + 1;
    assert.equal(row.width, Math.max(above, below, row.col + 1), `width of ${row.hash}`);
  }
};

for (const [name, commits] of Object.entries(all_dags)) {
  test(`lane layout of ${name}: lanes continue between rows, every parent edge reaches its parent, widths follow the lanes`, () => {
    const { rows, state } = lay_out(commits, empty_lanes);
    check_continuity(rows);
    check_parents(rows);
    check_widths(rows);
    assert.deepEqual(state.lanes, [], "no lane is open after the last commit");
  });

  test(`lane layout of ${name} in pages with the handed-over state equals the layout in one go`, () => {
    const whole = lay_out(commits, empty_lanes);
    for (let size = 1; size < commits.length; size += 1) {
      let state = empty_lanes;
      const rows: Row[] = [];
      for (let start = 0; start < commits.length; start += size) {
        const page = lay_out(commits.slice(start, start + size), state);
        rows.push(...page.rows);
        state = page.state;
      }
      assert.deepEqual(rows, whole.rows, `page size ${size}`);
      assert.deepEqual(state, whole.state, `page size ${size}`);
    }
  });
}

test("a linear history stays in one lane with one color", () => {
  const { rows } = lay_out(linear, empty_lanes);
  assert.deepEqual(
    rows.map((row) => [row.col, row.color, row.width]),
    [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ],
  );
});

test("a merge opens a second lane for its second parent, and the branch bends into the lane already waiting for the fork point", () => {
  const { rows } = lay_out(branch_and_merge, empty_lanes);
  const merge = rows[0];
  assert.deepEqual(merge.down, [
    { from: 0, to: 0, color: 0 },
    { from: 0, to: 1, color: 1 },
  ]);
  const last_on_branch = rows.find((row) => row.hash === "e");
  assert.deepEqual(last_on_branch?.down, [
    { from: 1, to: 0, color: 0 },
    { from: 0, to: 0, color: 0 },
  ]);
  assert.equal(last_on_branch?.width, 2);
  const fork = rows.find((row) => row.hash === "b");
  assert.deepEqual(fork?.up, [{ from: 0, to: 0, color: 0 }]);
  assert.equal(fork?.width, 1);
});

test("an octopus merge opens one lane per extra parent", () => {
  const { rows } = lay_out(octopus, empty_lanes);
  assert.deepEqual(
    rows[0].down.map((edge) => edge.to),
    [0, 1, 2],
  );
  assert.equal(rows[0].width, 3);
});

test("a second branch tip takes the first free lane and a new color", () => {
  const { rows } = lay_out(fork_without_merge, empty_lanes);
  assert.deepEqual(
    rows.map((row) => [row.hash, row.col, row.color]),
    [
      ["t2", 0, 0],
      ["s2", 1, 1],
      ["t1", 0, 0],
      ["s1", 1, 1],
      ["base", 0, 0],
    ],
  );
});
