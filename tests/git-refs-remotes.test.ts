import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_refs, refs_fingerprint } from "../electron/git/refs.ts";
import { last_fetch_at, parse_remotes, primary_remote } from "../electron/git/remotes.ts";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);

test("git remote -v keeps the fetch url per remote, strips userinfo and accepts a promisor suffix", () => {
  const text = [
    "origin\thttps://user:ghp_secret@github.com/7teb/VantheaX.git (fetch)",
    "origin\thttps://github.com/7teb/VantheaX.git (push)",
    "public\tgit@github.com:7teb/VantheaV2.git (fetch)",
    "public\tgit@github.com:7teb/VantheaV2.git (push)",
    "lazy\tC:/repos/with space (fetch) [blob:none]",
    "lazy\tC:/repos/with space (push)",
    "",
  ].join("\n");
  const remotes = parse_remotes(text);
  assert.deepEqual(
    remotes.map((remote) => [remote.name, remote.url, remote.host_kind, remote.slug]),
    [
      ["origin", "https://github.com/7teb/VantheaX.git", "github", "7teb/VantheaX"],
      ["public", "git@github.com:7teb/VantheaV2.git", "github", "7teb/VantheaV2"],
      ["lazy", "C:/repos/with space", "local", null],
    ],
  );
  assert.doesNotMatch(JSON.stringify(remotes), /ghp_secret/);
});

test("the primary remote is the upstream remote, then origin, then the only one", () => {
  const remotes = parse_remotes("origin\thttps://github.com/o/r (fetch)\nfork/team\thttps://github.com/f/r (fetch)\n");
  assert.equal(primary_remote(remotes, "fork/team/main"), "fork/team");
  assert.equal(primary_remote(remotes, "origin/main"), "origin");
  assert.equal(primary_remote(remotes, null), "origin");
  assert.equal(primary_remote(parse_remotes("upstream\thttps://github.com/u/r (fetch)\n"), null), "upstream");
  assert.equal(primary_remote(parse_remotes("one\thttps://a/x (fetch)\ntwo\thttps://b/y (fetch)\n"), null), null);
  assert.equal(primary_remote([], null), null);
});

test("for-each-ref records split on NUL, peel annotated tags and drop remote HEAD", () => {
  const text = [
    `refs/heads/main\0${a}\0\0refs/remotes/origin/main\0ahead 2\0*\0D:/VantheaX`,
    `refs/heads/feature/x\0${b}\0\0refs/remotes/origin/feature/x\0gone\0 \0D:/VantheaX-wt/x`,
    `refs/remotes/origin/HEAD\0${a}\0\0\0\0 \0`,
    `refs/remotes/origin/main\0${a}\0\0\0\0 \0`,
    `refs/tags/v1.0\0${c}\0${a}\0\0\0 \0`,
    "",
  ].join("\n");
  assert.deepEqual(parse_refs(text), [
    { name: "main", kind: "branch", hash: a, target: a, upstream: "origin/main", track: "ahead 2", head: true, worktree: "D:/VantheaX" },
    { name: "feature/x", kind: "branch", hash: b, target: b, upstream: "origin/feature/x", track: "gone", head: false, worktree: "D:/VantheaX-wt/x" },
    { name: "origin/main", kind: "remote", hash: a, target: a, upstream: null, track: null, head: false, worktree: null },
    { name: "v1.0", kind: "tag", hash: c, target: a, upstream: null, track: null, head: false, worktree: null },
  ]);
});

test("the fingerprint changes with the refs output and with the head commit", () => {
  const raw = Buffer.from(`refs/heads/main\0${a}\n`);
  assert.equal(refs_fingerprint(raw, a), refs_fingerprint(Buffer.from(raw), a));
  assert.notEqual(refs_fingerprint(raw, a), refs_fingerprint(raw, b));
  assert.notEqual(refs_fingerprint(raw, a), refs_fingerprint(Buffer.from(`refs/heads/main\0${b}\n`), a));
});

test("FETCH_HEAD counts as the last fetch only when it names the remote url the way git writes it", () => {
  const head = { mtime_ms: Date.UTC(2026, 9, 15, 12), text: `${a}\t\tbranch 'main' of https://github.com/7teb/VantheaV2\n` };
  assert.equal(last_fetch_at(head, "https://github.com/7teb/VantheaV2.git"), "2026-10-15T12:00:00.000Z");
  assert.equal(last_fetch_at(head, "https://github.com/7teb/VantheaX.git"), null);
  const scp = { mtime_ms: 0, text: `${a}\tnot-for-merge\tbranch 'x' of github.com:7teb/VantheaX\n` };
  assert.equal(last_fetch_at(scp, "git@github.com:7teb/VantheaX.git"), "1970-01-01T00:00:00.000Z");
  assert.equal(last_fetch_at(null, "https://github.com/7teb/VantheaX.git"), null);
});
