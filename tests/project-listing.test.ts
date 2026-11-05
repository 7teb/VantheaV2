import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { invalidate_index, project_index } from "../electron/project/index.ts";
import { find_files, list_dir, max_dir_entries, max_matches, tree_path } from "../electron/project/listing.ts";

let root = "";
let outside = "";

const write = async (relative: string, text = "x") => {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-listing-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "vx-listing-outside-"));
  await write("src/main.ts");
  await write("src/util/strings.ts");
  await write("README.md");
  await write("file10.txt");
  await write("file2.txt");
  await write(".env", "TOKEN=1");
  await write("node_modules/pkg/index.js");
  await write(".git/HEAD");
  await write("dist/bundle.js");
  await write("docs/main.md");
  await fs.writeFile(path.join(outside, "elsewhere.txt"), "outside");
  await fs.symlink(outside, path.join(root, "outside-link"), "junction");
  await fs.symlink(path.join(root, "src"), path.join(root, "src-link"), "junction");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await fs.rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("tree paths normalize separators, dots and trailing slashes", () => {
  assert.equal(tree_path(""), "");
  assert.equal(tree_path("."), "");
  assert.equal(tree_path("./src/"), "src");
  assert.equal(tree_path("src\\util\\"), "src/util");
  assert.equal(tree_path("src//util/./x.ts"), "src/util/x.ts");
});

test("the root lists folders first in natural order and hides ignored folders and links that leave the project", async () => {
  const listing = await list_dir(root, "");
  assert.equal(listing.path, "");
  assert.equal(listing.more, 0);
  assert.deepEqual(
    listing.entries.map((entry) => `${entry.kind}:${entry.path}`),
    ["dir:docs", "dir:src", "dir:src-link", "file:.env", "file:file2.txt", "file:file10.txt", "file:README.md"],
  );
});

test("a nested folder lists one level with project-relative child paths", async () => {
  const listing = await list_dir(root, "src\\");
  assert.equal(listing.path, "src");
  assert.deepEqual(listing.entries, [
    { name: "util", path: "src/util", kind: "dir" },
    { name: "main.ts", path: "src/main.ts", kind: "file" },
  ]);
  assert.deepEqual((await list_dir(root, "src-link")).entries.map((entry) => entry.path), ["src-link/util", "src-link/main.ts"]);
});

test("listing outside the project or a missing folder is refused", async () => {
  await assert.rejects(list_dir(root, ".."), /outside the project/);
  await assert.rejects(list_dir(root, "outside-link"), /outside the project/);
  await assert.rejects(list_dir(root, "nope"), /does not exist/);
});

test("a huge folder is capped and reports how many entries were left out", async () => {
  const big = path.join(root, "big");
  await fs.mkdir(big);
  const count = max_dir_entries + 7;
  await Promise.all(Array.from({ length: count }, (_, index) => fs.writeFile(path.join(big, `f${index}.txt`), "")));
  const listing = await list_dir(root, "big");
  assert.equal(listing.entries.length, max_dir_entries);
  assert.equal(listing.more, 7);
  assert.deepEqual(listing.entries.slice(0, 3).map((entry) => entry.name), ["f0.txt", "f1.txt", "f2.txt"]);
  await fs.rm(big, { recursive: true, force: true });
  invalidate_index(root);
});

test("the file filter matches file names, ranks prefix matches first and skips ignored folders", async () => {
  invalidate_index(root);
  assert.deepEqual(await find_files(root, "  "), { paths: [], truncated: false });
  const main = await find_files(root, "MAIN");
  assert.deepEqual(main.paths, ["src/main.ts", "docs/main.md"]);
  assert.equal(main.truncated, false);
  const ts = await find_files(root, "s.ts");
  assert.deepEqual(ts.paths, ["src/util/strings.ts"]);
  assert.deepEqual((await find_files(root, "index")).paths, []);
  assert.deepEqual((await find_files(root, ".env")).paths, [".env"]);
  const prefix = await find_files(root, "file");
  assert.deepEqual(prefix.paths, ["file2.txt", "file10.txt"]);
});

test("the file filter finds files inside secret folders the tree shows, the agent index still skips them", async () => {
  await write(".ssh/config", "Host x");
  await write("secrets.d/token.txt", "t");
  invalidate_index(root);
  assert.deepEqual((await list_dir(root, ".ssh")).entries.map((entry) => entry.path), [".ssh/config"]);
  assert.deepEqual((await find_files(root, "config")).paths, [".ssh/config"]);
  assert.deepEqual((await find_files(root, "token")).paths, ["secrets.d/token.txt"]);
  const agent = await project_index(root);
  assert.equal(agent.files.some((file) => file.path.startsWith(".ssh/") || file.path.startsWith("secrets.d/")), false);
  assert.deepEqual(agent.directories.filter((dir) => dir === ".ssh" || dir === "secrets.d").sort(), [".ssh", "secrets.d"]);
  await fs.rm(path.join(root, ".ssh"), { recursive: true, force: true });
  await fs.rm(path.join(root, "secrets.d"), { recursive: true, force: true });
  invalidate_index(root);
});

test("the file filter reports when more files match than it returns", async () => {
  const many = path.join(root, "many");
  await fs.mkdir(many);
  await Promise.all(Array.from({ length: max_matches + 5 }, (_, index) => fs.writeFile(path.join(many, `hit${index}.log`), "")));
  invalidate_index(root);
  const result = await find_files(root, "hit");
  assert.equal(result.paths.length, max_matches);
  assert.equal(result.truncated, true);
  await fs.rm(many, { recursive: true, force: true });
  invalidate_index(root);
});
