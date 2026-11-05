import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import type { DiffSummary } from "../shared/turn-diff.ts";
import { line_diff } from "../electron/project/diff.ts";
import { turn_diffs } from "../electron/turn-diff/index.ts";
import { scratch, write } from "./git-kit.ts";
import { agent_write, close_turn, open_turn, read_turns_file, start_service } from "./turn-diff-service-kit.ts";

before(start_service);

const ready = (summary: DiffSummary | undefined) => {
  if (summary?.kind !== "ready") throw new Error(`summary is ${JSON.stringify(summary)}`);
  return summary;
};

const changed_lines = (count: number, tag: string) => `${[...Array(count).keys()].map((index) => `${tag} ${index}`).join("\n")}\n`;

test("without git the before copy is taken only at the first write of a file in a turn and the note says commands are not covered", async () => {
  const folder = await scratch("tdrec-first");
  await write(folder, { "a.txt": "v1\n" });
  await open_turn("rec-first", "t1", folder);
  await agent_write("rec-first", path.join(folder, "a.txt"), "v2\n");
  await agent_write("rec-first", path.join(folder, "a.txt"), "v3\n");
  close_turn("rec-first", "t1");
  const [summary] = await turn_diffs.summaries("rec-first", [{ kind: "turn", from_id: "t1", to_id: "t1" }]);
  const shown = ready(summary);
  assert.equal(shown.source, "recorded");
  assert.equal(shown.end.kind, "snapshot");
  assert.deepEqual(shown.notes, [{ kind: "no_git", reason: "not_repo", detail: folder }]);
  assert.deepEqual(shown.entries, [{ path: "a.txt", orig_path: null, status: "modified", added: 1, removed: 1, binary: false, commits: null }]);
  const diff = await turn_diffs.file("rec-first", { kind: "turn", from_id: "t1", to_id: "t1" }, "a.txt");
  assert.deepEqual(diff.kind === "text" ? diff.lines.map((line) => `${line.kind} ${line.text}`) : [], ["remove v1", "add v3"]);
  const stored = await read_turns_file("rec-first");
  assert.equal(stored.turns[0].files.length, 1);
  assert.equal(stored.turns[0].mode, "recorded");
});

test("created and deleted files are added and deleted, a file created and removed again is left out", async () => {
  const folder = await scratch("tdrec-kinds");
  await write(folder, { "old.txt": "old\n" });
  await open_turn("rec-kinds", "t1", folder);
  await agent_write("rec-kinds", path.join(folder, "new.txt"), "fresh\n");
  await agent_write("rec-kinds", path.join(folder, "old.txt"), null);
  await agent_write("rec-kinds", path.join(folder, "temp.txt"), "t\n");
  await fs.rm(path.join(folder, "temp.txt"));
  await agent_write("rec-kinds", path.join(folder, "pic.bin"), Buffer.from([0, 1, 2, 0]));
  await agent_write("rec-kinds", path.join(await scratch("tdrec-outside"), "x.txt"), "outside\n");
  close_turn("rec-kinds", "t1");
  const [summary] = await turn_diffs.summaries("rec-kinds", [{ kind: "turn", from_id: "t1", to_id: "t1" }]);
  assert.deepEqual(
    ready(summary).entries.map((entry) => [entry.path, entry.status, entry.added, entry.removed, entry.binary]),
    [
      ["new.txt", "added", 1, 0, false],
      ["old.txt", "deleted", 0, 1, false],
      ["pic.bin", "added", null, null, true],
    ],
  );
  assert.deepEqual(await turn_diffs.file("rec-kinds", { kind: "turn", from_id: "t1", to_id: "t1" }, "pic.bin"), { kind: "binary" });
  await assert.rejects(turn_diffs.file("rec-kinds", { kind: "turn", from_id: "t1", to_id: "t1" }, "temp.txt"), /temp\.txt is not a changed file of this diff/);
});

test("a turn group is the union of its records: before from the first, after from the last", async () => {
  const folder = await scratch("tdrec-union");
  await write(folder, { "a.txt": "1\n" });
  await open_turn("rec-union", "t1", folder);
  await agent_write("rec-union", path.join(folder, "a.txt"), "2\n");
  close_turn("rec-union", "t1");
  await open_turn("rec-union", "t2", folder, "agent_report");
  await agent_write("rec-union", path.join(folder, "a.txt"), "3\n");
  await agent_write("rec-union", path.join(folder, "b.txt"), "b\n");
  close_turn("rec-union", "t2");
  const [group, second, chat] = await turn_diffs.summaries("rec-union", [
    { kind: "turn", from_id: "t1", to_id: "t2" },
    { kind: "turn", from_id: "t2", to_id: "t2" },
    { kind: "chat" },
  ]);
  assert.deepEqual(ready(group).entries.map((entry) => entry.path), ["a.txt", "b.txt"]);
  const diff = await turn_diffs.file("rec-union", { kind: "turn", from_id: "t1", to_id: "t2" }, "a.txt");
  assert.deepEqual(diff.kind === "text" ? diff.lines.map((line) => `${line.kind} ${line.text}`) : [], ["remove 1", "add 3"]);
  const only_second = await turn_diffs.file("rec-union", { kind: "turn", from_id: "t2", to_id: "t2" }, "a.txt");
  assert.deepEqual(only_second.kind === "text" ? only_second.lines.map((line) => `${line.kind} ${line.text}`) : [], ["remove 2", "add 3"]);
  assert.equal(ready(second).entries.length, 2);
  assert.equal(ready(chat).end.kind, "live");
});

test("a running turn reads the files from disk now", async () => {
  const folder = await scratch("tdrec-live");
  await write(folder, { "a.txt": "1\n" });
  await open_turn("rec-live", "t1", folder);
  await agent_write("rec-live", path.join(folder, "a.txt"), "2\n");
  await write(folder, { "a.txt": "changed by a command\n" });
  const [summary] = await turn_diffs.summaries("rec-live", [{ kind: "turn", from_id: "t1", to_id: "t1" }]);
  const shown = ready(summary);
  assert.equal(shown.end.kind, "live");
  assert.deepEqual(shown.notes.at(-1), { kind: "running" });
  const diff = await turn_diffs.file("rec-live", { kind: "turn", from_id: "t1", to_id: "t1" }, "a.txt");
  assert.deepEqual(diff.kind === "text" ? diff.lines.map((line) => line.text) : [], ["1", "changed by a command"]);
  close_turn("rec-live", "t1");
});

test("a file diff over 2000 changed lines comes back complete, while line_diff keeps its default limit", async () => {
  const folder = await scratch("tdrec-large");
  await write(folder, { "big.txt": changed_lines(2500, "old") });
  await open_turn("rec-large", "t1", folder);
  await agent_write("rec-large", path.join(folder, "big.txt"), changed_lines(2500, "new"));
  close_turn("rec-large", "t1");
  const diff = await turn_diffs.file("rec-large", { kind: "turn", from_id: "t1", to_id: "t1" }, "big.txt");
  assert.equal(diff.kind, "text");
  const lines = diff.kind === "text" ? diff.lines : [];
  assert.equal(lines.filter((line) => line.kind === "add").length, 2500);
  assert.equal(lines.filter((line) => line.kind === "remove").length, 2500);
  assert.equal(lines.some((line) => line.kind === "gap"), false);
  const capped = line_diff(changed_lines(2500, "old"), changed_lines(2500, "new"));
  assert.equal(capped.lines.length, 2001);
  assert.equal(capped.lines.at(-1)?.kind, "gap");
  assert.equal(capped.added, 2500);
});

test("a file the agent changes only by line endings reads as eol_only", async () => {
  const folder = await scratch("tdrec-eol");
  await write(folder, { "a.txt": "x\ny\n" });
  await open_turn("rec-eol", "t1", folder);
  await agent_write("rec-eol", path.join(folder, "a.txt"), "x\r\ny\r\n");
  close_turn("rec-eol", "t1");
  const [summary] = await turn_diffs.summaries("rec-eol", [{ kind: "turn", from_id: "t1", to_id: "t1" }]);
  assert.deepEqual(ready(summary).entries.map((entry) => [entry.path, entry.added, entry.removed]), [["a.txt", 0, 0]]);
  assert.deepEqual(await turn_diffs.file("rec-eol", { kind: "turn", from_id: "t1", to_id: "t1" }, "a.txt"), { kind: "eol_only" });
});
