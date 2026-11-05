import assert from "node:assert/strict";
import { test } from "node:test";
import type { DirEntry } from "../shared/ipc/files.ts";
import { file_language, highlightable, language_name } from "../src/components/code-language.ts";
import { after_close, base_name, change_targets, line_count, parent_dir, tree_rows, type DirLoad } from "../src/state/files-tree.ts";

const dir = (path: string): DirEntry => ({ name: base_name(path), path, kind: "dir" });
const file = (path: string): DirEntry => ({ name: base_name(path), path, kind: "file" });
const ready = (entries: DirEntry[], more = 0): DirLoad => ({ status: "ready", entries, more });

test("tree rows walk only expanded folders and show loading, failed and capped folders", () => {
  const dirs: Record<string, DirLoad> = {
    "": ready([dir("src"), dir("docs"), dir("assets"), file("README.md")], 3),
    src: ready([dir("src/util"), file("src/main.ts")]),
    "src/util": { status: "loading", entries: [], more: 0 },
    assets: { status: "failed", entries: [], more: 0 },
  };
  const rows = tree_rows(dirs, ["src", "src/util", "assets"]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "entry" ? `${row.depth}:${row.entry.path}${row.open ? "/" : ""}` : `${row.depth}:${row.kind}:${row.path}`)),
    ["0:src/", "1:src/util/", "2:loading:src/util", "1:src/main.ts", "0:docs", "0:assets/", "1:failed:assets", "0:README.md", "0:more:"],
  );
  assert.deepEqual(tree_rows({}, []), [{ kind: "loading", path: "", depth: 0 }]);
});

test("a change reloads the parent folder, the folder itself and every open file under a changed path", () => {
  const dirs = ["", "src", "src/util", "docs"];
  const files = ["src/main.ts", "src/util/a.ts", "README.md"];
  assert.deepEqual(change_targets({ paths: ["src/main.ts"], overflow: false }, dirs, files), { dirs: ["src"], files: ["src/main.ts"] });
  assert.deepEqual(change_targets({ paths: ["new.txt"], overflow: false }, dirs, files), { dirs: [""], files: [] });
  assert.deepEqual(change_targets({ paths: ["src"], overflow: false }, dirs, files), {
    dirs: ["", "src", "src/util"],
    files: ["src/main.ts", "src/util/a.ts"],
  });
  assert.deepEqual(change_targets({ paths: ["srcx/file.ts"], overflow: false }, dirs, files), { dirs: [], files: [] });
  assert.deepEqual(change_targets({ paths: [], overflow: true }, dirs, files), { dirs, files });
});

test("closing the active tab activates its right neighbour, or the left one at the end", () => {
  const paths = ["a.ts", "b.ts", "c.ts"];
  assert.equal(after_close(paths, "b.ts", "b.ts"), "c.ts");
  assert.equal(after_close(paths, "c.ts", "c.ts"), "b.ts");
  assert.equal(after_close(paths, "a.ts", "c.ts"), "c.ts");
  assert.equal(after_close(["a.ts"], "a.ts", "a.ts"), null);
});

test("line counts ignore one trailing newline and path helpers split on slashes", () => {
  assert.equal(line_count(""), 1);
  assert.equal(line_count("a"), 1);
  assert.equal(line_count("a\nb\n"), 2);
  assert.equal(line_count("a\n\n"), 2);
  assert.equal(base_name("src/util/a.ts"), "a.ts");
  assert.equal(base_name("a.ts"), "a.ts");
  assert.equal(parent_dir("src/util/a.ts"), "src/util");
  assert.equal(parent_dir("a.ts"), "");
});

test("file names map to highlight languages without changing markdown fence names", () => {
  assert.equal(file_language("src/state/files.ts"), "typescript");
  assert.equal(file_language("App.TSX"), "typescript");
  assert.equal(file_language("scripts/build.ps1"), "powershell");
  assert.equal(file_language("tools/Module.psm1"), "powershell");
  assert.equal(file_language("app/App.csproj"), "xml");
  assert.equal(file_language("Dockerfile"), "dockerfile");
  assert.equal(file_language(".env.local"), "ini");
  assert.equal(file_language("notes.txt"), "plaintext");
  assert.equal(file_language(".gitignore"), "");
  assert.equal(file_language("Makefile"), "");
  assert.equal(file_language("main.cpp"), "cpp");
  assert.equal(language_name("psm1"), "psm1");
  assert.equal(language_name("TS"), "typescript");
  assert.equal(highlightable("plaintext"), false);
  assert.equal(highlightable(""), false);
  assert.equal(highlightable("rust"), true);
});
