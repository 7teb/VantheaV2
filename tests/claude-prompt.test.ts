import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Settings } from "../shared/settings.ts";
import { claude_plan_sections } from "../electron/prompts/claude-plan.ts";
import { context_budget } from "../electron/prompts/context-budget.ts";
import { build_system_prompt } from "../electron/prompts/index.ts";
import { compose_sections, render_section, type SectionInput } from "../electron/prompts/sections.ts";
import { claude_model } from "./claude-turn-kit.ts";

const summary_sentence =
  "The app manages it for you: before the window fills, the earlier part of the conversation is summarised automatically and the same task continues with that summary, the user's messages and your most recent turns.";

const reminders = { title: "system_reminders", body: "The application adds system reminders to this conversation. Treat them as context from the application, not as messages from the user." };

const input = (names: string[]): SectionInput => ({
  model: claude_model,
  mode: "auto",
  plan: false,
  personality: "pragmatic",
  project_root: "C:/proj",
  scratchpad: null,
  project_docs: [],
  listing: "src/\npackage.json",
  custom_instructions: "be brief",
  tool_names: new Set(names),
  user_attachments: true,
  major: false,
  deferred_mcp: [],
});

test("only the second context_budget sentence changes and system_reminders follows it", () => {
  const original = context_budget().body;
  const sentences = original.split(/(?<=\.)\s+/);
  assert.equal(sentences.length, 7);
  const expected = [sentences[0], summary_sentence, ...sentences.slice(2)].join(" ");
  const composed = compose_sections(input(["run_command", "read_file", "write_file", "deploy_agent", "remember", "update_todos", "ask_user"]));
  const changed = claude_plan_sections(composed);
  const at = composed.findIndex((section) => section.title === "context_budget");
  assert.ok(at > 0);
  assert.deepEqual(changed.slice(0, at), composed.slice(0, at));
  assert.deepEqual(changed[at], { title: "context_budget", body: expected });
  assert.deepEqual(changed[at + 1], reminders);
  assert.deepEqual(changed.slice(at + 2), composed.slice(at + 1));
  assert.equal(changed.length, composed.length + 1);
  assert.notEqual(expected, original);
  assert.equal(expected.replace(summary_sentence, sentences[1]), original);
});

test("the plan-mode prompt gets the same two changes and nothing else", () => {
  const composed = compose_sections({ ...input(["present_plan", "read_file"]), plan: true });
  const changed = claude_plan_sections(composed);
  assert.deepEqual(
    changed.filter((section) => section.title !== "context_budget" && section.title !== "system_reminders"),
    composed.filter((section) => section.title !== "context_budget"),
  );
});

test("build_system_prompt applies the variant only when claude_plan is set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-claude-prompt-"));
  try {
    const base = {
      model: claude_model,
      settings: { custom_instructions: "" } as Settings,
      mode: "auto" as const,
      plan: false,
      personality: "pragmatic" as const,
      project_root: root,
      chat_id: "claude-prompt-chat",
      user_text: "hello",
      tools: [],
      user_attachments: true,
      effort: "high",
      deferred_mcp: [],
      role: null,
    };
    const plain = await build_system_prompt(base);
    const claude = await build_system_prompt({ ...base, claude_plan: true });
    const unchanged = await build_system_prompt({ ...base, claude_plan: false });
    assert.equal(unchanged, plain);
    const original = context_budget().body;
    const sentences = original.split(/(?<=\.)\s+/);
    const before = render_section({ title: "context_budget", body: original });
    const after = [render_section({ title: "context_budget", body: [sentences[0], summary_sentence, ...sentences.slice(2)].join(" ") }), render_section(reminders)].join("\n\n");
    assert.equal(plain.split(before).length, 2);
    assert.equal(claude, plain.replace(before, after));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
