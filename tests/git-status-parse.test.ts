import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_status } from "../shared/git/status-parse.ts";

const hash = "e5ddba0000000000000000000000000000000000";

const z = (...records: string[]) => `${records.join("\0")}\0`;

test("branch headers give oid, head, upstream, ahead and behind, and stash", () => {
  const { branch } = parse_status(z(`# branch.oid ${hash}`, "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -0", "# stash 3"));
  assert.deepEqual(branch, { oid: hash, head: "main", upstream: "origin/main", ahead: 2, behind: 0, stash: 3 });
});

test("an unborn branch, a detached head and an upstream without ab line", () => {
  assert.deepEqual(parse_status(z("# branch.oid (initial)", "# branch.head main")).branch, { oid: null, head: "main", upstream: null, ahead: null, behind: null, stash: 0 });
  assert.equal(parse_status(z(`# branch.oid ${hash}`, "# branch.head (detached)")).branch.head, null);
  const gone = parse_status(z(`# branch.oid ${hash}`, "# branch.head feature", "# branch.upstream origin/does-not-exist")).branch;
  assert.equal(gone.upstream, "origin/does-not-exist");
  assert.equal(gone.ahead, null);
});

test("unknown headers are ignored", () => {
  const parsed = parse_status(z("# branch.oid (initial)", "# future.header with words", "# branch.head main"));
  assert.equal(parsed.branch.head, "main");
  assert.deepEqual(parsed.entries, []);
});

test("ordinary entries map XY to status, staged and unstaged, with spaces and umlauts in paths", () => {
  const entries = parse_status(
    z(
      `1 .M N... 100644 100644 100644 ${hash} ${hash} a b.txt`,
      `1 MM N... 100644 100644 100644 ${hash} ${hash} ümlaut ä.txt`,
      `1 .D N... 100644 100644 000000 ${hash} ${hash} del.txt`,
      `1 A. N... 000000 100644 100644 ${hash} ${hash} added.txt`,
      `1 .T N... 100644 100644 120000 ${hash} ${hash} link`,
      `1 .A N... 000000 000000 100644 ${"0".repeat(40)} ${"0".repeat(40)} intent.txt`,
    ),
  ).entries;
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.status, entry.staged, entry.unstaged]),
    [
      ["a b.txt", "modified", false, true],
      ["ümlaut ä.txt", "modified", true, true],
      ["del.txt", "deleted", false, true],
      ["added.txt", "added", true, false],
      ["link", "type_changed", false, true],
      ["intent.txt", "added", false, true],
    ],
  );
});

test("a rename entry takes its original path from the next NUL record", () => {
  const parsed = parse_status(z(`2 R. N... 100644 100644 100644 ${hash} ${hash} R100 mv dst.txt`, "mv src.txt", "? after.txt"));
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries[0], { path: "mv dst.txt", orig_path: "mv src.txt", status: "renamed", staged: true, unstaged: false, conflict: null, submodule: null, nested_repo: false });
  assert.equal(parsed.entries[1]?.path, "after.txt");
  const copied = parse_status(z(`2 C. N... 100644 100644 100644 ${hash} ${hash} C75 copy.txt`, "orig.txt")).entries[0];
  assert.equal(copied?.status, "copied");
});

test("unmerged entries carry the conflict kind", () => {
  const entries = parse_status(z(`u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} both.txt`, `u AA N... 000000 100644 100644 100644 ${hash} ${hash} ${hash} added both.txt`)).entries;
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.status, entry.conflict]),
    [
      ["both.txt", "conflicted", "UU"],
      ["added both.txt", "conflicted", "AA"],
    ],
  );
});

test("submodule state comes from the S field", () => {
  const entry = parse_status(z(`1 .M S.MU 160000 160000 160000 ${hash} ${hash} libs/ops`)).entries[0];
  assert.deepEqual(entry?.submodule, { commit: false, tracked: true, untracked: true });
  const moved = parse_status(z(`1 .M SC.. 160000 160000 160000 ${hash} ${hash} libs/ops`)).entries[0];
  assert.deepEqual(moved?.submodule, { commit: true, tracked: false, untracked: false });
});

test("untracked and ignored entries keep a trailing slash for folders", () => {
  const entries = parse_status(z("? newdir/", "? new file.txt", "! ignored/", "! x.log")).entries;
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.status]),
    [
      ["newdir/", "untracked"],
      ["new file.txt", "untracked"],
      ["ignored/", "ignored"],
      ["x.log", "ignored"],
    ],
  );
});
