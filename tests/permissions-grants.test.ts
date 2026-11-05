import assert from "node:assert/strict";
import { test } from "node:test";
import { covering_prefixes, suggest_prefix, type PrefixGrant } from "../electron/permissions/grants.ts";

const grant_covers = (command: string, grants: PrefixGrant[]) => covering_prefixes(command, grants).length > 0;

const grant = (prefix: string, example = prefix): PrefixGrant => ({ prefix, example });

test("suggested prefixes take the command and its first plain argument", () => {
  assert.equal(suggest_prefix("npm run build"), "npm run");
  assert.equal(suggest_prefix("git commit -m 'x'"), "git commit");
  assert.equal(suggest_prefix("python scripts/build.py --fast"), "python scripts/build.py");
  assert.equal(suggest_prefix("cargo"), "cargo");
  assert.equal(suggest_prefix("npm install; npm install lodash"), "npm install");
  assert.equal(suggest_prefix("npm run build 2>&1 | Select-Object -Last 40"), "npm run");
  assert.equal(suggest_prefix("npm install; cargo build"), null);
  assert.equal(suggest_prefix("& 'C:/tools/x.exe' run"), null);
  assert.equal(suggest_prefix("$x = 1"), null);
});

test("no suggestion falls back to a bare command or covers deleting and killing", () => {
  assert.equal(suggest_prefix("Remove-Item -Recurse -Force dist"), null);
  assert.equal(suggest_prefix("Remove-Item dist"), null);
  assert.equal(suggest_prefix("Stop-Process -Name overlay"), null);
  assert.equal(suggest_prefix("node --test x.ts"), null);
  assert.equal(suggest_prefix("git -C D:/x status"), null);
  assert.equal(suggest_prefix("Get-ChildItem -Recurse"), null);
  assert.equal(suggest_prefix("git status"), "git status");
  assert.equal(grant_covers("git status --short", [grant("git status")]), false);
  assert.equal(grant_covers("git status", [grant("git status")]), true);
});

test("a prefix grant covers a command only when every acting statement matches", () => {
  const grants = [grant("npm run", "npm run build")];
  assert.equal(grant_covers("npm run build", grants), true);
  assert.equal(grant_covers("NPM   RUN test", grants), true);
  assert.equal(grant_covers("npm run build | Select-Object -Last 20", grants), true);
  assert.equal(grant_covers("npm run-script build", grants), false);
  assert.equal(grant_covers("npm run build; Remove-Item dist -Recurse", grants), false);
  assert.equal(grant_covers("npm run build && npm run test", grants), true);
  assert.equal(grant_covers("npm run build $(Remove-Item x)", grants), false);
  assert.equal(grant_covers("npm run build", []), false);
});

test("a grant never covers a flag the approved command did not use", () => {
  const install = [grant("npm install", "npm install lodash")];
  assert.equal(grant_covers("npm install left-pad", install), true);
  assert.equal(grant_covers("npm install -g typescript", install), false);
  assert.equal(grant_covers("npm install --global typescript", install), false);
  assert.equal(grant_covers("npm i --location=global typescript", install), false);
  const release = [grant("cargo build", "cargo build --release")];
  assert.equal(grant_covers("cargo build --release", release), true);
  assert.equal(grant_covers("cargo build --release --target x86_64-pc-windows-msvc", release), false);
  assert.equal(grant_covers("npm run test -- --watch", [grant("npm run", "npm run build")]), false);
});

test("several prefixes together can cover a multi-statement command, deletions never", () => {
  assert.equal(grant_covers("npm install; cargo build", [grant("npm install")]), false);
  assert.equal(grant_covers("npm install; cargo build", [grant("npm install"), grant("cargo build")]), true);
  assert.equal(grant_covers("Remove-Item dist", [grant("Remove-Item", "Remove-Item dist")]), false);
  assert.equal(grant_covers("Stop-Process -Name overlay", [grant("Stop-Process", "Stop-Process -Name overlay")]), false);
});
