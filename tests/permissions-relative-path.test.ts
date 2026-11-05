import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { resolved, create_values, word_value } from "../electron/permissions/command-values.ts";
import { location_change, start_location } from "../electron/permissions/command-location.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";
import { fit_actions } from "../electron/permissions/review-sections.ts";
import { trim_steps } from "../electron/permissions/review-budget.ts";

const roots: string[] = [];
after(async () => { for (const dir of roots) await fs.rm(dir, { recursive: true, force: true }); });
const root = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-relative-path-")); roots.push(dir); return dir; };

test("relative PATH entries use each command's changed cwd, not the initial project cwd", async () => {
  const dir = await root();
  for (const location of ["bin", "sub/bin"]) {
    await fs.mkdir(path.join(dir, location), { recursive: true });
    await fs.writeFile(path.join(dir, location, "probe.exe"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]));
  }
  const seen = await inspect_command_sources(dir, dir, "Set-Location sub; probe.exe", { chat_id: "review-cwd", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "bin", PATHEXT: ".EXE" } });
  assert.equal(seen.programs.find((program) => program.kind === "native")?.path.toLowerCase(), path.join(dir, "sub", "bin", "probe.exe").toLowerCase());
  assert.deepEqual(seen.gaps, []);
});

test("relative PATH with unknown cwd creates a gap instead of guessing the initial cwd", async () => {
  const dir = await root();
  const seen = await inspect_command_sources(dir, dir, "Set-Location $unresolved; probe.exe", { chat_id: "review-unknown-cwd", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "bin", PATHEXT: ".EXE" } });
  assert.ok(seen.gaps.some((gap) => /working directory unknown/.test(gap)), JSON.stringify(seen));
});

test("multiple pushd exchanges and popd preserve the ordered location stack", () => {
  const args = (text: string) => shell_words(text, "posix").map((word) => ({ word, value: word_value(word, create_values({}), "posix") }));
  let state = start_location("D:/first");
  state = location_change("pushd", args("../second"), state, "posix", "pushd ../second")!;
  state = location_change("pushd", args("../third"), state, "posix", "pushd ../third")!;
  state = location_change("pushd", [], state, "posix", "pushd")!;
  assert.deepEqual(state.current, resolved(["D:\\second"]));
  assert.deepEqual(state.stack, [resolved(["D:\\first"]), resolved(["D:\\third"])]);
  state = location_change("popd", [], state, "posix", "popd")!;
  assert.deepEqual(state.current, resolved(["D:\\third"]));
  assert.deepEqual(state.stack, [resolved(["D:\\first"])]);
});

test("trimmed recent Unicode write actions retain their text within the byte cap", () => {
  const level = trim_steps.indexOf("actions") + 1;
  const actions = Array.from({ length: 25 }, (_, index) => ({ key: String(index), kind: "write" as const, full: "full", text: JSON.stringify({ path: `${index}.txt`, text: index === 24 ? "REVIEW-RECENT-ÄÖ漢字" : "漢字".repeat(800) }), path_only: JSON.stringify({ path: `${index}.txt` }) }));
  const fit = fit_actions(actions, level, 2);
  assert.ok(fit.some((line) => line.includes("REVIEW-RECENT-ÄÖ漢字")));
  assert.ok(Buffer.byteLength(fit.join("\n"), "utf8") <= 40000);
});
