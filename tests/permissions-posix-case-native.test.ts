import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { floor_reason } from "../electron/permissions/floor.ts";
import { split_statements_posix } from "../electron/permissions/statements-posix.ts";
import { walk_command } from "../electron/permissions/command-walk.ts";

const bash = "C:/Program Files/Git/bin/bash.exe";
const payload = "rm -rf /c/Windows";
const scope = { app_root: "C:/Users/test/AppData/Roaming/VantheaX", project_root: "D:/project", cwd: "D:/project" };
const sources = [
  `function f { case value in value) ${payload};; esac; }; f`,
  `case "$(${payload})" in esac`,
  `case value in "$(${payload})") :;; esac`,
  `case value in ${"${vx_pattern:-$(" + payload + ")}"}) :;; esac`,
  `case value in "${"${vx_pattern:-$(" + payload + ")}"}") :;; esac`,
  `case value in ${"${vx_pattern:-`" + payload + "`}"}) :;; esac`,
  `case value in ${"${vx_pattern:-\"${vx_nested:-$(" + payload + ")}\"}"}) :;; esac`,
  `case value \\\nin value) ${payload};; esac`,
  `case\\\n value in value) ${payload};; esac`,
  `case value in\\\n value) ${payload};; esac`,
];

test("case edge forms execute their harmless replacement in native Bash", { skip: !fs.existsSync(bash) }, () => {
  for (const source of sources) {
    const safe = "unset vx_pattern vx_nested; " + source.replace(payload, "printf PATTERN_EXECUTED >&2");
    const child = spawnSync(bash, ["--noprofile", "--norc", "-c", safe], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.equal(child.status, 0, `${source}\n${child.stderr}`);
    assert.equal(child.stderr, "PATTERN_EXECUTED", source);
  }
});

for (const source of sources) {
  test(`the review catches an executable case branch or pattern ${JSON.stringify(source)}`, () => {
    assert.ok(split_statements_posix(source).includes(payload), source);
    assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
    const steps = [...walk_command(source, { dialect: "posix", location: "D:/project", env: {} })];
    assert.ok(steps.some((step) => step.command && step.words[0]?.word.raw === "rm"), source);
  });
}
