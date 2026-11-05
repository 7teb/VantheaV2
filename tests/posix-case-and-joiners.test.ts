import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { floor_reason } from "../electron/permissions/floor.ts";
import { posix_script, split_statements_posix, split_pipelines_posix, statement_parts_posix } from "../electron/permissions/statements-posix.ts";
import { walk_command } from "../electron/permissions/command-walk.ts";

const bash = "C:/Program Files/Git/bin/bash.exe";
const dangerous = "rm -rf /c/Windows";
const scope = { app_root: "C:/Users/test/AppData/Roaming/VantheaX", project_root: "D:/project", cwd: "D:/project" };

test("braces joined to hashes are shell words rather than comment boundaries", () => {
  for (const word of ["{#", "}#", "x{#", "x}#"]) {
    const source = `printf '%s' ${word}; ${dangerous}`;
    assert.ok(split_statements_posix(source).includes(dangerous), source);
    assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
  }
});

test("logical OR separates pipelines and records the proper joiner", () => {
  const source = "false || printf AFTER | cat";
  assert.deepEqual(split_pipelines_posix(source), ["false", "printf AFTER | cat"]);
  assert.deepEqual(statement_parts_posix(source).map((part) => [part.joiner, part.elements.map((entry) => entry.text)]), [["", ["false"]], ["||", ["printf AFTER", "cat"]]]);
  assert.deepEqual(posix_script(source).pipelines.map((pipeline) => pipeline.stages.map((stage) => stage.text)), [["false"], ["printf AFTER", "cat"]]);
});

test("case branch commands are inspected in every scanner API", () => {
  const source = `case value in value) ${dangerous};; esac`;
  assert.ok(split_statements_posix(source).includes(dangerous));
  assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/);
});

test("reported forms execute a harmless following command in actual Bash", { skip: !fs.existsSync(bash) }, () => {
  for (const source of ["printf '%s' {#; printf AFTER", "printf '%s' }#; printf AFTER", "false || printf AFTER", "case value in value) printf AFTER;; esac"]) {
    const child = spawnSync(bash, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.equal(child.status, 0, `${source}\n${child.stderr}`);
    assert.equal(child.stderr, "", source);
    assert.ok(child.stdout.endsWith("AFTER"), source);
  }
});

const cases = [
  `case value in value) ${dangerous};; esac`,
  `case value in (other|value) ${dangerous};; esac`,
  `case value in other) :;; *) ${dangerous};; esac`,
  `case value in value) :;& *) ${dangerous};; esac`,
  `case value in value) :;;& *) ${dangerous};; esac`,
  `case value in value) ${dangerous}\nesac`,
  `case value in value) case nested in nested) ${dangerous};; esac;; esac`,
  `(case value in value) ${dangerous};; esac)`,
  `printf '%s' "$(case value in value) ${dangerous};; esac)"`,
  `{ case value in value) ${dangerous};; esac; }`,
  `f() { case value in value) ${dangerous};; esac; }; f`,
  `if case value in value) ${dangerous};; esac; then :; fi`,
  `case value\n# header comment\nin\n# pattern comment\n'value') ${dangerous};;\nesac`,
  `case value in "a)b"|value) ${dangerous};; esac`,
  `case value \\\nin value) ${dangerous};; esac`,
  `case\\\n value in value) ${dangerous};; esac`,
  `case value in\\\n value) ${dangerous};; esac`,
  `ca\\\nse value i\\\nn value) ${dangerous};; es\\\nac`,
];

test("case bodies remain inspected through nested shell structures and branch terminators", () => {
  for (const source of cases) {
    assert.ok(split_statements_posix(source).includes(dangerous), source);
    assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
  }
});

test("source inspection sees case branch programs including substitutions and subshells", () => {
  for (const source of cases) {
    const steps = [...walk_command(source, { dialect: "posix", location: "D:/project", env: {} })];
    assert.ok(steps.some((step) => step.command && step.words[0]?.word.raw === "rm"), source);
  }
});

test("case selectors and patterns execute substitutions even without a branch", () => {
  for (const source of [`case "$(${dangerous})" in esac`, `case value in "$(${dangerous})") :;; esac`, `case value in \`${dangerous}\`) :;; esac`, `case value in \${vx_pattern:-$(${dangerous})}) :;; esac`]) {
    assert.ok(split_statements_posix(source).includes(dangerous), source);
    assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
  }
});

test("case branch states are isolated and ordinary quoted case text remains data", () => {
  assert.match(floor_reason("cd /c; case value in other) cd /d;; *) rm -rf Windows;; esac", scope, "posix"), /Windows \/ System32/);
  for (const source of [`printf '%s' 'case value in value) ${dangerous};; esac'`, `case value in '${dangerous}') :;; esac`, `printf '%s' case value in value`]) {
    assert.equal(floor_reason(source, scope, "posix"), "", source);
  }
});

test("case edge grammar executes harmless selected bodies in actual Bash", { skip: !fs.existsSync(bash) }, () => {
  for (const original of cases) {
    const source = original.replaceAll(dangerous, "printf AFTER");
    const child = spawnSync(bash, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.equal(child.status, 0, `${source}\n${child.stderr}`);
    assert.equal(child.stderr, "", source);
    assert.ok(child.stdout.endsWith("AFTER"), source);
  }
});
