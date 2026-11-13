import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { arrange_sections } from "../electron/prompts/index.ts";
import { load_project_docs } from "../electron/prompts/project.ts";
import type { PromptSection } from "../electron/prompts/sections.ts";

const section = (title: string): PromptSection => ({ title, body: title });

const titles = (sections: PromptSection[]) => sections.map((entry) => entry.title);

test("the user's rules come after every built-in section, the listing and the role, and memories come last", () => {
  const composed = ["identity", "writing_code", "communication", "file_content", "project_listing", "personality", "user_instructions", "project_instructions"].map(section);
  const extra = ["skills", "memories", "saved_workflows"].map(section);
  assert.deepEqual(titles(arrange_sections(composed, [section("major_review")], extra, section("sub_agent_role"))), [
    "identity",
    "writing_code",
    "communication",
    "file_content",
    "major_review",
    "skills",
    "saved_workflows",
    "project_listing",
    "sub_agent_role",
    "personality",
    "user_instructions",
    "project_instructions",
    "memories",
  ]);
  assert.deepEqual(titles(arrange_sections(composed, [], [], null)).slice(-4), ["project_listing", "personality", "user_instructions", "project_instructions"]);
});

test("AGENTS.md and CLAUDE.md are loaded whole, however long they are", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-project-docs-"));
  try {
    const long = Array.from({ length: 3000 }, (_, index) => `- rule ${index}: keep names in snake_case`).join("\n");
    await fs.writeFile(path.join(root, "AGENTS.md"), long);
    await fs.writeFile(path.join(root, "CLAUDE.md"), "﻿short rules\n");
    const docs = await load_project_docs(root);
    assert.ok(long.length > 100_000);
    assert.deepEqual(docs, [
      { name: "AGENTS.md", content: long },
      { name: "CLAUDE.md", content: "short rules" },
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
