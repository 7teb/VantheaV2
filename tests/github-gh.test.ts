import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitOutput } from "../electron/git/run.ts";
import { cli_of, create_gh_cache, find_gh, gh_env, gh_transport, host_account, parse_auth_status, parse_gh_response, read_gh_status, type GhProbe, type GhRun } from "../electron/github/gh-cli.ts";

const output = (code: number, stdout: string, stderr = ""): GitOutput => ({ code, stdout: Buffer.from(stdout), stderr });

const not_modified =
  "HTTP/2.0 304 Not Modified\nCache-Control: private, max-age=60, s-maxage=60\r\nEtag: \"abc\"\r\nX-Ratelimit-Remaining: 4990\r\nX-Ratelimit-Reset: 1792112009\r\n\r\n";

const call = { host: "github.com", path: "repos/o/r", headers: { Accept: "application/vnd.github+json", "If-None-Match": 'W/"abc"' }, signal: new AbortController().signal };

test("gh api -i output is split into status line, headers and body", () => {
  const ok = parse_gh_response('HTTP/2.0 200 OK\nContent-Type: application/json; charset=utf-8\r\nEtag: W/"1"\r\nX-Github-Sso: required; url=https://github.com/orgs/acme/sso\r\n\r\n{"full_name":"o/r"}');
  assert.equal(ok?.status, 200);
  assert.equal(ok?.headers.etag, 'W/"1"');
  assert.equal(ok?.headers["x-github-sso"], "required; url=https://github.com/orgs/acme/sso");
  assert.equal(ok?.body, '{"full_name":"o/r"}');
  const cached = parse_gh_response(not_modified);
  assert.equal(cached?.status, 304);
  assert.equal(cached?.headers["x-ratelimit-remaining"], "4990");
  assert.equal(cached?.body, "");
  assert.equal(parse_gh_response("error connecting to api.github.com\n"), null);
});

test("the gh transport reads a 304 that exits with 1, a missing login and a network failure", async () => {
  const args: string[][] = [];
  const answers: GitOutput[] = [output(1, not_modified, "gh: HTTP 304\n"), output(4, "", "To get started with GitHub CLI, please run:  gh auth login\n"), output(1, "", "error connecting to api.github.com\n")];
  const run: GhRun = async (...parts) => {
    args.push(parts[1]);
    return answers.shift() ?? output(1, "");
  };
  const transport = gh_transport(() => "C:\\Tools\\gh.exe", run);
  const first = await transport(call);
  assert.equal(first.kind === "response" ? first.response.status : first.kind, 304);
  assert.deepEqual(args[0], ["api", "-i", "--hostname", "github.com", "-H", "Accept: application/vnd.github+json", "-H", 'If-None-Match: W/"abc"', "repos/o/r"]);
  assert.equal((await transport(call)).kind, "signed_out");
  assert.deepEqual(await transport(call), { kind: "offline", detail: "error connecting to api.github.com" });
  assert.equal((await gh_transport(() => null, run)(call)).kind, "signed_out");
});

test("auth status with several hosts and accounts, broken entries are skipped", () => {
  const accounts = parse_auth_status(
    JSON.stringify({
      hosts: {
        "github.com": [
          { state: "success", active: true, host: "github.com", login: "octocat", tokenSource: "keyring", scopes: "repo" },
          { state: "error", active: false, host: "github.com", login: "7teb", error: "bad token" },
          { state: "success", active: false, host: "github.com", login: "bad login; rm" },
        ],
        "ACME.ghe.com": [{ state: "success", active: true, host: "acme.ghe.com", login: "octo_acme" }],
        "evil host": [{ state: "success", active: true, login: "x" }],
      },
    }),
  );
  assert.deepEqual(accounts, [
    { host: "github.com", login: "octocat", active: true, state: "success" },
    { host: "github.com", login: "7teb", active: false, state: "error" },
    { host: "acme.ghe.com", login: "octo_acme", active: true, state: "success" },
  ]);
  const status = { kind: "found" as const, exe: "gh.exe", accounts };
  assert.equal(host_account(status, "github.com")?.login, "octocat");
  assert.deepEqual(cli_of(status, "github.com"), { state: "ready", version: null });
  assert.deepEqual(cli_of(status, "git.example.com"), { state: "signed_out", version: null });
  assert.deepEqual(cli_of({ kind: "missing" }, "github.com"), { state: "missing", version: null });
  assert.deepEqual(parse_auth_status('{"hosts":{}}'), []);
});

test("a gh without auth status --json counts as too old with its version", async () => {
  const args: string[][] = [];
  const probe: GhProbe = {
    env: {},
    exists: () => true,
    run: async (...parts) => {
      args.push(parts[1]);
      return parts[1][0] === "--version" ? output(0, "gh version 2.40.1 (2023-12-13)\nhttps://github.com/cli/cli/releases/tag/v2.40.1\n") : output(1, "", "unknown flag: --json\n");
    },
  };
  assert.deepEqual(await read_gh_status(probe, "C:\\Tools\\gh.exe", "github.com"), { kind: "too_old", exe: "C:\\Tools\\gh.exe", version: "2.40.1" });
  assert.deepEqual(args[0], ["auth", "status", "--json", "hosts", "--hostname", "github.com"]);
  assert.deepEqual(cli_of({ kind: "too_old", exe: "gh.exe", version: "2.40.1" }, "github.com"), { state: "too_old", version: "2.40.1" });
});

test("gh is found only in absolute PATH entries, never in the working directory", () => {
  const present = new Set(["C:\\Tools\\gh.exe", "gh.exe", "bin\\gh.exe"]);
  const exists = (file: string) => present.has(file);
  assert.equal(find_gh({ env: { PATH: ".;bin;C:\\Tools" }, exists, run: async () => output(0, "") }), "C:\\Tools\\gh.exe");
  assert.equal(find_gh({ env: { Path: ".;bin" }, exists, run: async () => output(0, "") }), null);
});

test("gh runs without debug output, prompts, update checks or colors", () => {
  const env = gh_env({ PATH: "C:\\Tools", gh_debug: "api", DEBUG: "1", GH_FORCE_TTY: "1", no_color: "0", CLICOLOR_FORCE: "1", clicolor_force: "1", GH_TOKEN: "kept as the user set it" });
  assert.equal(env.CLICOLOR_FORCE, undefined);
  assert.equal(env.clicolor_force, undefined);
  assert.equal(env.gh_debug, undefined);
  assert.equal(env.DEBUG, undefined);
  assert.equal(env.GH_FORCE_TTY, undefined);
  assert.equal(env.no_color, undefined);
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.GH_PROMPT_DISABLED, "1");
  assert.equal(env.GH_NO_UPDATE_NOTIFIER, "1");
  assert.equal(env.GH_TOKEN, "kept as the user set it");
});

test("the gh sign-in is read for one host at a time and cached per host", async () => {
  const args: string[][] = [];
  const probe: GhProbe = {
    env: { PATH: "C:\\Tools" },
    exists: (file) => file === "C:\\Tools\\gh.exe",
    run: async (...parts) => {
      args.push(parts[1]);
      return output(0, '{"hosts":{}}');
    },
  };
  const cache = create_gh_cache(probe);
  await cache.status("gitlab.com");
  await cache.status("gitlab.com");
  await cache.status("github.com");
  await cache.reread("gitlab.com");
  assert.deepEqual(
    args.map((entry) => entry.slice(-2)),
    [
      ["--hostname", "gitlab.com"],
      ["--hostname", "github.com"],
      ["--hostname", "gitlab.com"],
    ],
  );
  assert.equal(cache.exe(), "C:\\Tools\\gh.exe");
});
