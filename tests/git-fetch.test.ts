import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { classify_fetch, fetch_blocked, fetch_call, fetch_period_ms } from "../electron/git/fetch.ts";
import { exec_git } from "../electron/git/run.ts";
import { create_git_session } from "../electron/git/session.ts";
import { default_readers } from "../electron/git/readers.ts";
import { cloned_pair, fetch_rig, isolated_config, ref_of, target_of, wait_for } from "./git-fetch-kit.ts";
import { git, marker, posix, quiet_window, repo_with, skip_without_git, tool } from "./git-kit.ts";

const options = { skip: skip_without_git };

const closers: (() => void)[] = [];

after(() => {
  for (const close of closers) close();
});

await isolated_config();

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

test("stderr of a failed fetch maps to the cases the card shows", () => {
  assert.equal(classify_fetch("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "auth_required");
  assert.equal(classify_fetch("remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/o/r.git/'"), "auth_required");
  assert.equal(classify_fetch("git@github.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository."), "ssh_key_rejected");
  assert.equal(classify_fetch("Host key verification failed.\nfatal: Could not read from remote repository."), "ssh_host_unknown");
  assert.equal(classify_fetch("remote: Repository not found.\nfatal: repository 'https://github.com/o/x.git/' not found"), "remote_not_found");
  assert.equal(classify_fetch("ssh: Could not resolve hostname github.com: Name or service not known"), "offline");
  assert.equal(classify_fetch("fatal: unable to access 'https://github.com/o/r.git/': Failed to connect to github.com port 443"), "offline");
  assert.equal(classify_fetch("error: cannot lock ref 'refs/remotes/origin/main': is at abc but expected def"), "busy");
  assert.equal(classify_fetch("fatal: Unable to create 'D:/r/.git/packed-refs.lock': File exists."), "busy");
  assert.equal(classify_fetch("fatal: something new"), "error");
});

test("an http server answering 401 ends as missing credentials and no askpass program is asked", options, async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  const port = (server.address() as net.AddressInfo).port;
  const root = await repo_with("fetch-401", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", `http://127.0.0.1:${port}/r.git`);
  const mark = await marker();
  const askpass = path.join(mark.dir, "askpass.sh");
  await fs.writeFile(askpass, `#!/bin/sh\necho ran >> '${mark.file}'\necho secret\n`);
  process.env.SSH_ASKPASS = posix(askpass);
  try {
    const target = await target_of(root);
    assert.deepEqual(fetch_blocked(target), { kind: "insecure_transport", scheme: "http" });
    const output = await exec_git(tool(), fetch_call(target));
    assert.notEqual(output.code, 0);
    assert.equal(classify_fetch(output.stderr), "auth_required");
    assert.equal(await mark.ran(), false);
    const plain = await new Promise<number>((resolve) => {
      execFile(tool().exe, ["fetch", "origin"], { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true }, (error) => resolve(typeof error?.code === "number" ? error.code : 0));
    });
    assert.notEqual(plain, 0);
    assert.equal(await mark.ran(), true);
  } finally {
    delete process.env.SSH_ASKPASS;
  }
});

test("a fetch from a local bare remote moves the tracking ref, writes no FETCH_HEAD and records the time", options, async () => {
  const pair = await cloned_pair("fetch-local");
  const pushed = await pair.push("second");
  const fetch_head = path.join(pair.local, ".git", "FETCH_HEAD");
  await fs.rm(fetch_head, { force: true });
  const rig = fetch_rig();
  const target = await target_of(pair.local);
  rig.fetcher.request(target, "refresh");
  await wait_for("the fetch", () => rig.fetcher.status(target.common_dir, "origin").at !== null);
  assert.equal(ref_of(pair.local, "refs/remotes/origin/main"), pushed);
  assert.equal(await exists(fetch_head), false);
  assert.deepEqual({ ...rig.fetcher.status(target.common_dir, "origin"), at: null }, { at: null, running: false, error: null, paused: false, queued: false });
  assert.ok((rig.fetcher.next_tick(target) ?? 0) > fetch_period_ms - 5_000);
});

test("no fetch runs while a turn or a background task works in the repository, a refresh then runs right after the end", options, async () => {
  const pair = await cloned_pair("fetch-busy");
  const before = ref_of(pair.local, "refs/remotes/origin/main");
  const pushed = await pair.push("second");
  const rig = fetch_rig();
  const target = await target_of(pair.local);
  rig.work.turns = [pair.local];
  rig.fetcher.request(target, "open");
  await wait_for("the pause", () => rig.fetcher.status(target.common_dir, "origin").paused);
  rig.work.turns = [];
  rig.work.tasks = [path.join(pair.local, "sub")];
  rig.fetcher.request(target, "refresh");
  await wait_for("the queued fetch", () => rig.fetcher.status(target.common_dir, "origin").queued);
  assert.equal(ref_of(pair.local, "refs/remotes/origin/main"), before);
  rig.busy.changed();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(ref_of(pair.local, "refs/remotes/origin/main"), before);
  rig.work.tasks = [];
  rig.busy.changed();
  await wait_for("the fetch after the end", () => rig.fetcher.status(target.common_dir, "origin").at !== null);
  assert.equal(ref_of(pair.local, "refs/remotes/origin/main"), pushed);
  const status = rig.fetcher.status(target.common_dir, "origin");
  assert.deepEqual([status.paused, status.queued], [false, false]);
});

test("git:// is never fetched and nothing is scheduled for it", options, async () => {
  const root = await repo_with("fetch-git-proto", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", "git://127.0.0.1:9/r.git");
  const rig = fetch_rig();
  const target = await target_of(root);
  assert.deepEqual(fetch_blocked(target), { kind: "insecure_transport", scheme: "git" });
  rig.fetcher.request(target, "refresh");
  rig.fetcher.request(target, "open");
  assert.equal(rig.fetcher.next_tick(target), null);
  assert.deepEqual(rig.fetcher.status(target.common_dir, "origin"), { at: null, running: false, error: null, paused: false, queued: false });
});

test("a remote helper address over plain http is blocked like an http url, one over https is not", options, async () => {
  const root = await repo_with("fetch-helper", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", "http::http://127.0.0.1:9/r.git");
  git(root, "remote", "add", "plain", "http::127.0.0.1:9/r.git");
  git(root, "remote", "add", "tls", "http::https://127.0.0.1:9/r.git");
  git(root, "remote", "add", "downgrade", "https::http://127.0.0.1:9/r.git");
  assert.deepEqual(fetch_blocked(await target_of(root)), { kind: "insecure_transport", scheme: "http" });
  assert.deepEqual(fetch_blocked(await target_of(root, "plain")), { kind: "insecure_transport", scheme: "http" });
  assert.equal(fetch_blocked(await target_of(root, "tls")), null);
  assert.deepEqual(fetch_blocked(await target_of(root, "downgrade")), { kind: "insecure_transport", scheme: "http" });
});

test("an unknown fetch failure shows the first line git printed, not its generic fatal line", options, async () => {
  const root = await repo_with("fetch-ssh-refused", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", "ssh://git@127.0.0.1:9/r.git");
  const rig = fetch_rig();
  const target = await target_of(root);
  rig.fetcher.request(target, "refresh");
  await wait_for("the failed fetch", () => rig.fetcher.status(target.common_dir, "origin").error !== null);
  const error = rig.fetcher.status(target.common_dir, "origin").error;
  assert.equal(error?.kind, "error");
  assert.match(error?.detail ?? "", /^ssh: connect to host 127\.0\.0\.1 port 9/);
});

const hanging_server = async () => {
  const sockets: { closed: boolean }[] = [];
  const server = net.createServer((socket) => {
    const entry = { closed: false };
    sockets.push(entry);
    socket.on("close", () => {
      entry.closed = true;
    });
    socket.on("error", () => {
      entry.closed = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return { sockets, port: (server.address() as net.AddressInfo).port };
};

test("refresh ends a fetch that hangs on the network and starts a new one, quitting ends that one", options, async () => {
  const hang = await hanging_server();
  const root = await repo_with("fetch-hang", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", `https://127.0.0.1:${hang.port}/r.git`);
  const rig = fetch_rig();
  const target = await target_of(root);
  rig.fetcher.request(target, "refresh");
  await wait_for("the first connection", () => hang.sockets.length === 1);
  assert.equal(rig.fetcher.status(target.common_dir, "origin").running, true);
  rig.fetcher.request(target, "refresh");
  await wait_for("the second connection", () => hang.sockets.length === 2);
  assert.equal(hang.sockets[0]?.closed, true);
  assert.equal(rig.fetcher.status(target.common_dir, "origin").running, true);
  rig.fetcher.shutdown();
  await wait_for("the end of the second fetch", () => hang.sockets[1]?.closed === true && !rig.fetcher.status(target.common_dir, "origin").running);
  assert.equal(rig.fetcher.status(target.common_dir, "origin").error, null);
});

test("the first session for a repository fetches it, stopping the session leaves the fetch running", options, async () => {
  const hang = await hanging_server();
  const root = await repo_with("fetch-session", { "a.txt": "a\n" });
  git(root, "remote", "add", "origin", `https://127.0.0.1:${hang.port}/r.git`);
  const rig = fetch_rig();
  const session = create_git_session({ path: root, name: "fetch-session", kind: "project" }, { readers: default_readers, publish: () => undefined, window: quiet_window, fetcher: rig.fetcher });
  await wait_for("the opening fetch", () => hang.sockets.length === 1);
  session.stop();
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(hang.sockets[0]?.closed, false);
  const target = await target_of(root);
  assert.equal(rig.fetcher.status(target.common_dir, "origin").running, true);
  rig.fetcher.shutdown();
  await wait_for("the end of the fetch", () => hang.sockets[0]?.closed === true);
});
