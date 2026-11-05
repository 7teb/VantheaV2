import assert from "node:assert/strict";
import { test } from "node:test";
import type { HumanDecision } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import { read_only_command } from "../electron/permissions/allowlist.ts";
import { decide_command, type CommandInput } from "../electron/permissions/decide.ts";
import { approved_with_source, human_decision, prefix_grants } from "../electron/permissions/decisions.ts";
import { floor_reason } from "../electron/permissions/floor.ts";
import { covering_prefixes, suggest_prefix } from "../electron/permissions/grants.ts";
import { msys_native } from "../electron/permissions/msys-paths.ts";
import { split_pipelines, split_statements, statement_parts } from "../electron/permissions/statements.ts";
import { split_pipelines_posix, split_statements_posix, statement_parts_posix } from "../electron/permissions/statements-posix.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { answer, main_review_actor, review_stub } from "./review-stub.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

const app_root = "C:\\Users\\user\\AppData\\Roaming\\VantheaX";

const scope = { app_root, project_root: "D:\\proj", cwd: "D:\\proj" };

let chats = 0;

const input = (mode: PermissionMode, command: string, extra: Partial<CommandInput> = {}): CommandInput => ({
  command,
  background: false,
  mode,
  app_root,
  project_root: "",
  cwd: "",
  plan: false,
  chat_id: `bash-${(chats += 1)}`,
  chat_started_at: Date.now(),
  call_id: "c1_0",
  profile: "main",
  custom_instructions: "",
  decisions: [],
  last_human_id: null,
  changed: [],
  shell: "posix",
  ...extra,
});

const signal = () => new AbortController().signal;

const grant = (shell: "powershell" | "bash", prefix: string, subject: string): HumanDecision =>
  human_decision(
    { kind: "command", command: subject, cwd: ".", background: false, shell, review: null, grant_prefix: prefix },
    { approved: true, grant: "prefix", feedback: "" },
    main_review_actor,
    null,
  );

test("the statement helpers split a bash dialect with the POSIX splitter", () => {
  const command = "echo a & rm -rf x; ls `whoami` && cat <<EOF\nrm -rf y\nEOF";
  assert.deepEqual(split_statements(command, "posix"), split_statements_posix(command));
  assert.deepEqual(split_pipelines("ls | grep a; pwd", "posix"), split_pipelines_posix("ls | grep a; pwd"));
  assert.deepEqual(statement_parts("cd a && ls | wc -l", "posix"), statement_parts_posix("cd a && ls | wc -l"));
  assert.ok(split_statements(command, "posix").includes("rm -rf x"));
  assert.ok(!split_statements(command, "posix").includes("rm -rf y"));
});

test("unresolved bash targets are blocked exactly where the PowerShell floor blocks their counterparts", () => {
  const pairs: [string, string][] = [
    ["Remove-Item $x -Recurse", "rm -rf $1"],
    ["Remove-Item $x -Recurse", "rm -rf $undefined_name"],
    ["Remove-Item $(Get-List)", "rm -rf $(cat list)"],
    ["Remove-Item C:\\$x -Recurse", "rm -rf /c/$x"],
    ['Remove-Item "$dir\\*" -Recurse', 'rm -rf "$dir/"*'],
    ["Remove-Item C:\\Windows\\$x -Recurse", "rm -rf /c/Windows/$x"],
    ["Remove-Item C:\\Windows\\$x -Recurse", "rm -rf C:/Windows/`ls`"],
    ["Remove-Item C:\\Windows$x", "rm -rf /c/Windows$x"],
    ['Remove-Item "C:\\Program Files\\$x"', 'rm -rf "/c/Program Files/$x"'],
    ['Remove-Item "$env:APPDATA\\VantheaX\\$x" -Recurse', 'rm -rf "$APPDATA/VantheaX/$x"'],
    ["Remove-Item C:\\Users\\$u\\AppData\\Roaming\\VantheaX -Recurse", "rm -rf /c/Users/$USER/AppData/Roaming/VantheaX"],
  ];
  for (const [powershell, bash] of pairs) {
    const expected = floor_reason(powershell, scope);
    assert.equal(Boolean(floor_reason(bash, scope, "posix")), Boolean(expected), `${bash} vs ${powershell}`);
  }
  assert.match(floor_reason("rm -rf ~/AppData/Roaming/VantheaX/${part}", scope, "posix"), /VantheaX's own/);
  assert.match(floor_reason("rm -rf /usr/$x", scope, "posix"), /Windows \/ System32/);
  assert.equal(floor_reason("rm -rf /$x", scope, "posix"), "");
  assert.equal(floor_reason("rm -rf /tmp/$x", scope, "posix"), "");
});

test("command substitutions in an unquoted heredoc body reach the floor, quoted or escaped ones do not", () => {
  for (const command of ["cat <<EOF\n$(rm -rf /c/Windows)\nEOF", "cat <<EOF\n`rm -rf /c/Windows`\nEOF", "cat <<-EOF\n\t$(rm -rf /c/Windows)\n\tEOF", "cat > notes.txt <<EOF\nhead\n$(rm -rf /c/Windows)\nEOF"]) {
    assert.match(floor_reason(command, scope, "posix"), /Windows \/ System32/, command);
  }
  for (const command of ["cat <<'EOF'\n$(rm -rf /c/Windows)\nEOF", 'cat <<"EOF"\n$(rm -rf /c/Windows)\nEOF', "cat <<\\EOF\n$(rm -rf /c/Windows)\nEOF", "cat <<EOF\n\\$(rm -rf /c/Windows)\nEOF"]) {
    assert.equal(floor_reason(command, scope, "posix"), "", command);
  }
});

test("read-only bash statements pass where their PowerShell counterparts pass", () => {
  for (const command of ["ls -la src", "cat package.json | head -20", "grep -rn TODO src | wc -l", "git status --short", "git log --oneline -5 2>/dev/null", "find . -name '*.ts' | sort", "rg needle && pwd"]) {
    assert.equal(read_only_command(command, "posix"), true, command);
  }
  for (const command of ["cat build.sh", "grep foo *.sh", "grep -n foo scripts/*.sh", "head -n 5 foo.bash", "which bash", "grep -rn eval src", "sort -u in.txt", "date -Iseconds", "cat <<'EOF'\n$(rm -rf x)\nEOF"]) {
    assert.equal(read_only_command(command, "posix"), true, command);
  }
  for (const [bash, powershell] of [["cat build.sh", "cat build.sh"], ["which bash", "where.exe bash"], ["grep -rn eval src", "Select-String -Pattern eval -Path src"]] as const) {
    assert.equal(read_only_command(bash, "posix"), read_only_command(powershell), `${bash} vs ${powershell}`);
  }
  for (const command of ["ls > out.txt", "find . -name '*.tmp' -delete", "find . -exec rm {} \\;", "cat list | xargs rm", "sed -i s/a/b/ f", "npm test", "cat $(rm -rf x)", "sort -o out.txt in.txt", "git branch -D old", "tee log.txt < in"]) {
    assert.equal(read_only_command(command, "posix"), false, command);
  }
  for (const command of ["sort -uo out.txt in.txt", "sort -ro out.txt in.txt", "sort --compress-program=./evil a", "sort --compress-prog=./evil a", "sort --out=x a", "file -C -m magic", "file -bC", "file --compile -m magic", "date -us 2020-01-01", "date --se=2020-01-01", "rg --hostname-bin=./evil x", "cat `sh -c ls`", "cat $(bash -c ls)", "cat <<EOF\n$(rm -rf x)\nEOF", "cat <<EOF\n`rm -rf x`\nEOF"]) {
    assert.equal(read_only_command(command, "posix"), false, command);
  }
  assert.equal(read_only_command("rg --hostname-bin=./evil.exe x"), false);
  assert.equal(read_only_command("Get-ChildItem src", "posix"), false);
  assert.equal(read_only_command("Get-ChildItem src"), true);
});

test("prefix grants split bash statements and never cover a removal or a kill", () => {
  assert.equal(suggest_prefix("cd build && make install", "posix"), null);
  assert.equal(suggest_prefix("make all", "posix"), "make all");
  assert.equal(suggest_prefix("ls && npm run build", "posix"), "npm run");
  assert.equal(suggest_prefix("find . -name '*.o' -delete", "posix"), null);
  assert.equal(suggest_prefix("pkill node", "posix"), null);
  assert.deepEqual(covering_prefixes("npm run lint & npm run build", [{ prefix: "npm run", example: "npm run build" }], "posix"), ["npm run"]);
  assert.deepEqual(covering_prefixes("npm run build | xargs rm", [{ prefix: "npm run", example: "npm run build" }], "posix"), []);
});

test("approvals and prefix grants of one shell never authorize the other shell", () => {
  const powershell = grant("powershell", "npm run", "npm run build");
  const bash = grant("bash", "make", "make all");
  assert.equal(powershell.tool, "run_command");
  assert.equal(powershell.shell, "powershell");
  assert.equal(bash.tool, "run_bash");
  assert.equal(bash.shell, "bash");
  assert.deepEqual(prefix_grants([powershell, bash], "powershell"), [{ prefix: "npm run", example: "npm run build" }]);
  assert.deepEqual(prefix_grants([powershell, bash], "bash"), [{ prefix: "make", example: "make all" }]);
  const legacy: HumanDecision = { ...powershell, shell: undefined };
  assert.deepEqual(prefix_grants([legacy], "bash"), []);
  const once = (shell: "powershell" | "bash"): HumanDecision => ({ ...grant(shell, "x", "./build.sh"), grant: "once", grant_prefix: undefined, source_hash: "h1" });
  assert.equal(approved_with_source([once("bash")], "./build.sh", "h1", "bash"), true);
  assert.equal(approved_with_source([once("powershell")], "./build.sh", "h1", "bash"), false);
  const background = human_decision({ kind: "command", command: "make", cwd: ".", background: true, shell: "bash", review: null, grant_prefix: null }, { approved: true, grant: "once", feedback: "" }, main_review_actor, null);
  assert.equal(background.tool, "start_background_task");
  assert.equal(background.shell, "bash");
});

test("decide_command uses the POSIX floor, plan rules and grants for bash", async () => {
  const blocked = await decide_command(input("full", "rm -rf /c/Windows/System32"), review_stub(), signal());
  assert.equal(blocked.action, "block");
  assert.equal(blocked.record?.tool, "run_bash");
  assert.equal((await decide_command(input("full", "rm -rf /c/Windows/System32", { background: true }), review_stub(), signal())).record?.tool, "start_background_task");
  assert.equal((await decide_command(input("full", "ls -la | grep src", { plan: true }), review_stub(), signal())).action, "run");
  const plan = await decide_command(input("full", "make install", { plan: true }), review_stub(), signal());
  assert.equal(plan.action, "ask");
  assert.equal(plan.plan, true);
  const decisions = [grant("bash", "make", "make all")];
  const granted = await decide_command(input("auto", "make test", { decisions }), review_stub([answer("review")]), signal());
  assert.equal(granted.action, "run");
  assert.deepEqual(granted.record?.grant_prefixes, ["make"]);
  const other_shell = await decide_command(input("auto", "make test", { decisions: [grant("powershell", "make", "make all")] }), review_stub([answer("review")]), signal());
  assert.equal(other_shell.action, "ask");
  assert.equal(other_shell.grant_prefix, "make test");
  const sort_write = await decide_command(input("full", "sort -uo out.txt in.txt", { plan: true }), review_stub(), signal());
  assert.equal(sort_write.action, "ask");
  assert.equal(sort_write.plan, true);
  const sort_grant = await decide_command(input("auto", "make test; sort -uo out.txt in.txt", { decisions }), review_stub([answer("review")]), signal());
  assert.equal(sort_grant.action, "ask");
});

test("the review input of a bash command names the shell", async () => {
  const stub = review_stub([answer("allow")]);
  await decide_command(input("auto", "ls -la"), stub, signal());
  const text = stub.calls[0]?.parts.map((part) => part.text).join("\n") ?? "";
  assert.match(text, /tool: run_bash\nworking directory: [^\n]*\nruns in background: no\nshell: Git Bash \(bash -c\)\n/);
  assert.match(stub.calls[0]?.system ?? "", /runs PowerShell or Git Bash commands/);
});

test("MSYS paths map to Windows paths, mounts and switches", () => {
  const mounts = { root: "C:\\Program Files\\Git", home: "C:\\Users\\me", temp: "C:\\Users\\me\\AppData\\Local\\Temp" };
  assert.equal(msys_native("/c/Users/me/x.txt", mounts), "C:\\Users\\me\\x.txt");
  assert.equal(msys_native("D:/data", mounts), "D:\\data");
  assert.equal(msys_native("~/notes", mounts), "C:\\Users\\me\\notes");
  assert.equal(msys_native("/usr/bin/grep", mounts), "C:\\Program Files\\Git\\usr\\bin\\grep");
  assert.equal(msys_native("/tmp/out", mounts), "C:\\Users\\me\\AppData\\Local\\Temp\\out");
  assert.equal(msys_native("//server/share/f", mounts), "\\\\server\\share\\f");
  assert.equal(msys_native("//F", mounts), null);
  assert.equal(msys_native("/dev/null", mounts), null);
  assert.equal(msys_native("src/a.ts", mounts), "src/a.ts");
  assert.equal(msys_native("/usr/bin", { ...mounts, root: null }), null);
});

test("a -c or -exec style flag as the last word neither throws nor invents a payload", () => {
  for (const command of ["sh ./configure -C", "bash ./build.sh -c", "bash -lc", "pwsh -c", "find . -exec", "find . -name x -execdir"]) {
    assert.deepEqual(split_statements(command, "posix"), [command]);
    assert.equal(floor_reason(command, scope, "posix"), "", command);
    assert.equal(read_only_command(command, "posix"), false, command);
  }
  assert.deepEqual(split_statements("bash ./build.sh -c 'rm -rf x'", "posix"), ["bash ./build.sh -c 'rm -rf x'"]);
  assert.deepEqual(split_statements("bash -o pipefail -c 'rm -rf x'", "posix"), ["bash -o pipefail -c 'rm -rf x'", "rm -rf x"]);
  assert.deepEqual(split_statements("bash -eo pipefail -c 'rm -rf x'", "posix"), ["bash -eo pipefail -c 'rm -rf x'", "rm -rf x"]);
  assert.deepEqual(split_statements("bash --norc -lc 'rm -rf x' _", "posix"), ["bash --norc -lc 'rm -rf x' _", "rm -rf x"]);
});

test("a wrapper with its own flags and operands does not hide a floor-protected deletion", () => {
  const app = "/c/Users/user/AppData/Roaming/VantheaX";
  const cases = [
    "rm -rf /c/Windows/System32",
    `rm -rf ${app}`,
    "find /c/Windows -delete",
    `find ${app} -delete`,
    "find /c/Windows -exec rm -rf {} +",
    `ls ${app} | xargs rm -rf`,
    'powershell -c "Remove-Item C:\\Windows -Recurse"',
    'cmd //c "rd /s /q C:\\Windows"',
  ];
  const prefixes = ["timeout 5 ", "timeout -s KILL 5 ", "timeout --signal KILL -k 2 5 ", "nice -n 5 ", "env -i ", "env -u HOME FOO=1 ", "stdbuf -o0 ", "stdbuf -o 0 ", "time -p ", "command -p ", "exec -a x ", "nohup nice -n 5 "];
  for (const command of cases) {
    const expected = floor_reason(command, scope, "posix");
    assert.notEqual(expected, "", command);
    for (const prefix of prefixes) {
      assert.equal(floor_reason(prefix + command, scope, "posix"), expected, prefix + command);
    }
  }
  const fed = floor_reason(`ls ${app} | xargs rm -rf`, scope, "posix");
  for (const prefix of prefixes) {
    assert.equal(floor_reason(`ls ${app} | ${prefix}xargs rm -rf`, scope, "posix"), fed, prefix);
    assert.equal(floor_reason(`${prefix}rm -rf ./build`, scope, "posix"), "", prefix);
  }
});

test("'..' climbs through the MSYS root the way Git Bash resolves it", () => {
  for (const target of ["/tmp/../c/Windows", "/dev/../c/Windows", "/tmp/..", "../../../../c/Windows", "/c/../c/Windows"]) {
    assert.match(floor_reason(`rm -rf ${target}`, scope, "posix"), /Windows \/ System32/, target);
  }
  assert.match(floor_reason("cd ../../..; rm -rf c/Windows", scope, "posix"), /Windows \/ System32/);
  assert.match(floor_reason("cd /tmp && rm -rf ../c/Windows", scope, "posix"), /Windows \/ System32/);
  assert.equal(floor_reason("rm -rf ./build", scope, "posix"), "");
  assert.equal(floor_reason("rm -rf ../proj/build", scope, "posix"), "");
  assert.equal(floor_reason("cd /tmp; rm -rf build", scope, "posix"), "");
  const mounts = { root: "C:\\Program Files\\Git", home: "C:\\Users\\me", temp: "C:\\Users\\me\\AppData\\Local\\Temp" };
  assert.equal(msys_native("/tmp/../c/x", mounts), "C:\\x");
  assert.equal(msys_native("/usr/bin/../lib", mounts), "C:\\Program Files\\Git\\usr\\lib");
});
