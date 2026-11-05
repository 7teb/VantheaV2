import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ConfigEntry, SshSettings } from "../electron/git/guard.ts";
import { guard_from } from "../electron/git/guard.ts";
import { parse_remote_url } from "../shared/git/remote-url.ts";
import { alias_candidate, alias_program, bundled_ssh, command_program, create_ssh_hosts, effective_ssh, fetch_ssh_command, resolve_alias, ssh_hostname, ssh_test_command } from "../electron/git/ssh.ts";
import { real_git, skip_without_git } from "./git-kit.ts";

const entry = (scope: string, key: string, value: string | null): ConfigEntry => ({ scope, key, value });

const settings = (...entries: ConfigEntry[]): SshSettings => guard_from(entries, []).ssh;

const none = settings();

const git_exe = "C:/Program Files/Git/cmd/git.exe";

const files = (...present: string[]) => (file: string) => present.includes(file.replace(/\\/g, "/"));

test("the effective ssh command follows git: app GIT_SSH_COMMAND, then core.sshCommand, then GIT_SSH, then ssh", () => {
  const global = settings(entry("global", "core.sshcommand", "C:/Windows/System32/OpenSSH/ssh.exe -i key"));
  assert.deepEqual(effective_ssh({ git_ssh_command: "ssh -F cfg", GIT_SSH: "C:/plink.exe" }, global), { text: "ssh -F cfg", shell: true, scope: "env" });
  assert.deepEqual(effective_ssh({ GIT_SSH: "C:/plink.exe" }, global), { text: "C:/Windows/System32/OpenSSH/ssh.exe -i key", shell: true, scope: "global" });
  assert.deepEqual(effective_ssh({ GIT_SSH: "C:/plink.exe" }, none), { text: "C:/plink.exe", shell: false, scope: "env" });
  assert.deepEqual(effective_ssh({}, none), { text: "ssh", shell: false, scope: "default" });
  const overridden = settings(entry("global", "core.sshcommand", "ssh"), entry("local", "core.sshcommand", "evil"));
  assert.equal(effective_ssh({}, overridden).scope, "local");
});

test("the fetch gets the batch switch of its ssh variant", () => {
  assert.equal(fetch_ssh_command({}, none), "ssh -o BatchMode=yes");
  assert.equal(fetch_ssh_command({}, settings(entry("system", "core.sshcommand", "C:/Windows/System32/OpenSSH/ssh.exe"))), "C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes");
  assert.equal(fetch_ssh_command({ GIT_SSH: "C:\\Program Files\\PuTTY\\plink.exe" }, none), "'C:\\Program Files\\PuTTY\\plink.exe' -batch");
  assert.equal(fetch_ssh_command({ GIT_SSH: "C:/TortoiseGit/bin/TortoisePlink.exe" }, none), "'C:/TortoiseGit/bin/TortoisePlink.exe'");
  assert.equal(fetch_ssh_command({ GIT_SSH_COMMAND: "my-ssh-wrapper" }, none), "my-ssh-wrapper -o BatchMode=yes");
  assert.equal(fetch_ssh_command({ GIT_SSH_COMMAND: "my-ssh-wrapper", GIT_SSH_VARIANT: "putty" }, none), "my-ssh-wrapper -batch");
  assert.equal(fetch_ssh_command({ GIT_SSH: "C:/tools/x.exe" }, settings(entry("global", "ssh.variant", "simple"))), "'C:/tools/x.exe'");
  assert.equal(fetch_ssh_command({}, settings(entry("local", "ssh.variant", "tortoiseplink"))), "ssh -o BatchMode=yes");
  assert.equal(fetch_ssh_command({ GIT_SSH: "C:/it's/plink.exe" }, none), "'C:/it'\\''s/plink.exe' -batch");
});

test("the program of a shell command is its first word, quotes included", () => {
  assert.equal(command_program('"C:/Program Files/OpenSSH/ssh.exe" -i key'), "C:/Program Files/OpenSSH/ssh.exe");
  assert.equal(command_program("'C:/x y/ssh.exe'"), "C:/x y/ssh.exe");
  assert.equal(command_program("  ssh -F cfg"), "ssh");
});

test("ssh -G only uses an ssh from protected sources, never a repository's own command", () => {
  const bundled = "C:/Program Files/Git/usr/bin/ssh.exe";
  const openssh = "C:/Windows/System32/OpenSSH/ssh.exe";
  assert.equal(bundled_ssh(git_exe, files(bundled)), "C:\\Program Files\\Git\\usr\\bin\\ssh.exe");
  assert.equal(bundled_ssh("C:/Program Files/Git/mingw64/bin/git.exe", files(bundled)), "C:\\Program Files\\Git\\usr\\bin\\ssh.exe");
  assert.equal(alias_program({ env: {}, exists: files(bundled) }, none, git_exe), "C:\\Program Files\\Git\\usr\\bin\\ssh.exe");
  assert.equal(alias_program({ env: {}, exists: files(bundled, openssh) }, settings(entry("global", "core.sshcommand", `${openssh} -i key`)), git_exe), openssh);
  assert.equal(alias_program({ env: { GIT_SSH_COMMAND: `"${openssh}" -v` }, exists: files(openssh) }, none, git_exe), openssh);
  assert.equal(alias_program({ env: {}, exists: files(bundled, openssh) }, settings(entry("local", "core.sshcommand", openssh)), git_exe), null);
  assert.equal(alias_program({ env: {}, exists: files(bundled, openssh) }, settings(entry("worktree", "core.sshcommand", openssh)), git_exe), null);
  assert.equal(alias_program({ env: { GIT_SSH: "C:/PuTTY/plink.exe" }, exists: files("C:/PuTTY/plink.exe") }, none, git_exe), null);
  assert.equal(alias_program({ env: { GIT_SSH_COMMAND: "./tools/ssh.exe" }, exists: () => true }, none, git_exe), null);
  assert.equal(alias_program({ env: { GIT_SSH_COMMAND: "myssh", PATH: ".;C:\\Tools" }, exists: files("C:/Tools/myssh.exe") }, none, git_exe), "C:\\Tools\\myssh.exe");
  assert.equal(alias_program({ env: { GIT_SSH_COMMAND: "myssh", PATH: "." }, exists: () => true }, none, git_exe), null);
});

test("ssh hosts with or without dots are aliases, a leading dash, whitespace or shell characters are dropped", () => {
  const candidate = (url: string) => alias_candidate(parse_remote_url(url));
  assert.equal(candidate("git@github-work:o/r.git"), "github-work");
  assert.equal(candidate("ssh://git@work_box/o/r.git"), "work_box");
  assert.equal(candidate("git@github.com-work:o/r.git"), "github.com-work");
  assert.equal(candidate("git@work.github.com:o/r.git"), "work.github.com");
  assert.equal(candidate("git@github.com:o/r.git"), "github.com");
  assert.equal(candidate("git@.hidden:o/r.git"), null);
  assert.equal(candidate("https://work/o/r.git"), null);
  assert.equal(candidate("git@-oProxyCommand=calc:o/r.git"), null);
  assert.equal(candidate("git@a b:o/r.git"), null);
  assert.equal(candidate("git@x;calc:o/r.git"), null);
});

test("the hostname line of ssh -G resolves an alias, an unchanged name stays unknown", () => {
  assert.equal(ssh_hostname("user git\nhostname github.com\nport 22\n", "github-work"), "github.com");
  assert.equal(ssh_hostname("hostname github-work\r\n", "github-work"), null);
  assert.equal(ssh_hostname("port 22\n", "github-work"), null);
});

test("the copied ssh test command keeps the url's user, host and port and refuses anything a shell would read", () => {
  assert.equal(ssh_test_command("git@github.com:o/r.git"), "ssh -T git@github.com");
  assert.equal(ssh_test_command("ssh://ssh.github.com:443/o/r.git"), "ssh -T -p 443 git@ssh.github.com");
  assert.equal(ssh_test_command("acme@acme.ghe.com:o/r.git"), "ssh -T acme@acme.ghe.com");
  assert.equal(ssh_test_command("ssh://acme.ghe.com/o/r.git"), "ssh -T acme@acme.ghe.com");
  assert.equal(ssh_test_command("git@github-work:o/r.git"), "ssh -T git@github-work");
  assert.equal(ssh_test_command("https://github.com/o/r.git"), null);
  assert.equal(ssh_test_command("git@x;calc:o/r.git"), null);
  assert.equal(ssh_test_command("$(calc)@github.com:o/r.git"), null);
});

test("ssh -G runs the program path itself without a shell, also with a space in the path", { skip: skip_without_git }, async () => {
  const program = real_git ? bundled_ssh(real_git.exe, fs.existsSync) : null;
  if (!program) {
    console.info(`[test] ${real_git?.exe} has no bundled ssh.exe next to it, the real ssh -G case is skipped`);
    return;
  }
  assert.equal(await resolve_alias(program, "vx-no-such-alias-7f3c", process.env), null);
});

test("a remote behind a repository-owned ssh command keeps its alias host and nothing is started", () => {
  const remotes = [{ name: "origin", url: "git@github-work:o/r.git", host: "github-work", host_kind: "other" as const, slug: "o/r" }];
  const tool = { exe: process.execPath, version: "2.54.0", numbers: [2, 54, 0] as [number, number, number], local_env: [] };
  const owned = settings(entry("local", "core.sshcommand", process.execPath));
  let probed = 0;
  const probe = {
    env: {},
    exists: () => {
      probed += 1;
      return true;
    },
  };
  const hosts = create_ssh_hosts(probe, new AbortController().signal, () => assert.fail("nothing may resolve"));
  hosts.request(remotes, tool, owned);
  assert.deepEqual(hosts.apply(remotes), remotes);
  assert.equal(probed, 0);
});

test("ssh -G runs in the background, the remotes stay as they are until the host arrives", { skip: skip_without_git }, async () => {
  const program = real_git ? bundled_ssh(real_git.exe, fs.existsSync) : null;
  if (!real_git || !program) {
    console.info(`[test] ${real_git?.exe} has no bundled ssh.exe next to it, the background ssh -G case is skipped`);
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vx-ssh-home-"));
  fs.mkdirSync(path.join(home, ".ssh"));
  fs.writeFileSync(path.join(home, ".ssh", "config"), "Host github.com-work\n  HostName github.com\n");
  try {
    const remotes = [{ name: "origin", url: "git@github.com-work:o/r.git", host: "github.com-work", host_kind: "other" as const, slug: "o/r" }];
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_SSH/i.test(name)));
    let resolved = 0;
    const hosts = create_ssh_hosts({ env: { ...env, HOME: home }, exists: fs.existsSync }, new AbortController().signal, () => {
      resolved += 1;
    });
    hosts.request(remotes, real_git, none);
    assert.deepEqual(hosts.apply(remotes), remotes);
    for (let waited = 0; resolved === 0; waited += 25) {
      if (waited > 20_000) throw new Error("ssh -G did not answer within 20 s");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.deepEqual(hosts.apply(remotes), [{ ...remotes[0], host: "github.com", host_kind: "github" }]);
    hosts.request(remotes, real_git, none);
    assert.equal(resolved, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
