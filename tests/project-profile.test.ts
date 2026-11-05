import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { git_location } from "../electron/git/repo.ts";
import { git_line, read_profile } from "../electron/permissions/project-profile.ts";
import { strip_userinfo } from "../shared/git/remote-url.ts";

const roots: string[] = [];

const scratch = async (files: Record<string, string>): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-profile-"));
  roots.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
  return root;
};

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const config = [
  '[core]\n\trepositoryformatversion = 0',
  '[remote "origin"]\n\turl = https://user:ghp_secret@github.com/example/shop.git',
  '[remote "public"]\n\turl = git@github.com:example/shop.git',
  '[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main',
].join("\n");

test("branch, upstream and remotes come from the .git files with userinfo stripped", async () => {
  const root = await scratch({ ".git/HEAD": "ref: refs/heads/main\n", ".git/config": config, "README.md": "# Shop\n", "package.json": '{"scripts":{"test":"node --test"}}' });
  const profile = await read_profile(root);
  assert.equal(profile.git, "git: repository at root, branch main, upstream origin/main, remote origin https://github.com/example/shop.git, remote public git@github.com:example/shop.git");
  assert.doesNotMatch(profile.git, /ghp_secret/);
  assert.equal(profile.readme, "# Shop");
  assert.equal(profile.scripts, '{"test":"node --test"}');
  assert.match(profile.listing, /README\.md/);
});

test("a worktree .git file is followed through gitdir and commondir, includes are not read", async () => {
  const main = await scratch({ ".git/config": `${config}\n[include]\n\tpath = extra.conf`, ".git/worktrees/feature/HEAD": "0123456789abcdef0123456789abcdef01234567\n", ".git/worktrees/feature/commondir": "../..\n" });
  const tree = await scratch({});
  await fs.writeFile(path.join(tree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "feature")}\n`);
  const location = await git_location(tree);
  assert.equal(location?.common_dir, path.join(main, ".git"));
  assert.equal(await git_line(tree, location), "git: repository at root, detached at 0123456789ab, remote origin https://github.com/example/shop.git, remote public git@github.com:example/shop.git, config includes not read");
});

test("a folder outside any repository gives one plain line and no profile file is invented", async () => {
  const root = await scratch({});
  assert.equal(await git_line(root, null), "git: not a git repository");
  assert.equal((await read_profile("")).git, "git: no project folder");
  assert.equal(strip_userinfo("https://token@host/x.git"), "https://host/x.git");
});

test("the profile reads files only and starts no child process", async () => {
  const source = await fs.readFile(path.join(import.meta.dirname, "..", "electron", "permissions", "project-profile.ts"), "utf8");
  assert.doesNotMatch(source, /child_process|execFile|spawn/);
});
