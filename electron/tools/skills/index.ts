import fs from "node:fs/promises";
import path from "node:path";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { max_skill_bytes } from "../../skills/frontmatter.ts";
import type { SkillRecord } from "../../skills/scan.ts";
import { prepare_skill } from "../../skills/source.ts";
import { note_reason, unanswered_text } from "../../permissions/verdict-text.ts";
import { commit_skill, find_skill, install_target, usable_skills } from "../../skills/store.ts";
import { error_text } from "../../storage/coerce.ts";
import { read_string, require_string } from "../browser/common.ts";
import { define_tool, type Tool, type ToolResult } from "../types.ts";

const max_body_chars = 100_000;

const result = (status: ToolResult["status"], action: "read" | "install", name: string, text: string): ToolResult => ({
  status,
  text,
  view: { kind: "skill", action, name },
});

const read_extra = async (skill: SkillRecord, wanted: string): Promise<ToolResult> => {
  const key = wanted.trim().replace(/\\/g, "/").toLowerCase();
  const name = skill.files.find((file) => file.toLowerCase() === key);
  if (!name) {
    const known = skill.files.length ? `Its extra files: ${skill.files.join(", ")}.` : "It has no extra files.";
    return result("failed", "read", skill.name, `The skill "${skill.name}" has no extra file "${wanted.slice(0, 120)}". ${known}`);
  }
  const file = path.join(skill.dir, name);
  try {
    const stat = await fs.stat(file);
    if (stat.size > max_skill_bytes) {
      return result("failed", "read", skill.name, `${name} of the skill "${skill.name}" is ${stat.size} bytes, read_skill returns extra files up to ${max_skill_bytes} bytes. Its path is ${file}.`);
    }
    const content = await fs.readFile(file, "utf8");
    return result("done", "read", skill.name, `FILE "${name}" of the skill "${skill.name}":\n\n${content}`);
  } catch (error) {
    console.error(`[skills] reading the extra file ${file} failed:`, error);
    return result("failed", "read", skill.name, `Reading ${name} of the skill "${skill.name}" failed: ${error_text(error)}`);
  }
};

const read_skill_tool = define_tool<{ name: string; file: string | null }>({
  spec: {
    name: "read_skill",
    description:
      "Load the full text of one installed skill by its name. The installed skills are listed with their descriptions in your system prompt; call this as soon as a task matches one of those descriptions, before you start working on it. Read-only and free, so prefer reading a matching skill over guessing the procedure yourself. The result names the skill folder on disk and lists the extra files the skill ships, including files one subfolder deep such as styles/intro.md; load one by calling read_skill again with the same name and file set to that path as listed.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact skill name as listed in the installed skills section." },
        file: { type: "string", description: "Optional. One extra file of the skill, exactly as listed by an earlier read_skill result (for example notes.md or styles/intro.md). Omit it to load the skill itself." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan", "explore", "worker"],
  available: () => usable_skills().length > 0,
  parse: (raw) => ({ name: require_string(raw, "name"), file: read_string(raw, "file") }),
  run: async (_ctx, args) => {
    const skill = find_skill(args.name);
    if (!skill) {
      const names = usable_skills().map((entry) => entry.name);
      const known = names.length ? `Installed skills: ${names.join(", ")}.` : "No skills are installed.";
      return result("failed", "read", args.name, `Unknown skill "${args.name.slice(0, 120)}". ${known}`);
    }
    if (args.file) {
      return read_extra(skill, args.file);
    }
    const body = skill.body.length > max_body_chars ? `${skill.body.slice(0, max_body_chars)}\n\n[skill text truncated]` : skill.body;
    const extras = skill.files.length ? `\nExtra files (load one with read_skill and file): ${skill.files.join(", ")}` : "";
    return result("done", "read", skill.name, `SKILL "${skill.name}": ${skill.description}\nSkill folder: ${skill.dir}${extras}\n\n${body}`);
  },
});

const install_skill_tool = define_tool<{ source: string }>({
  spec: {
    name: "install_skill",
    description:
      "Install a skill from a GitHub URL, a direct URL to a SKILL.md, or an absolute local path to a skill folder. The automatic review checks the exact content before anything is written and may ask the user; in ask mode the user always approves it. Use it only when the user asked for a skill to be added. The tool result contains the installed skill's name and description, so you can read_skill it immediately in the same turn.",
    parameters: {
      type: "object",
      properties: { source: { type: "string", description: "GitHub folder or SKILL.md URL, a direct https URL to a SKILL.md, or an absolute local path." } },
      required: ["source"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ source: require_string(raw, "source") }),
  run: async (ctx, args) => {
    let prepared;
    let existing;
    try {
      prepared = await prepare_skill(args.source, ctx.signal);
      existing = install_target(prepared.name).replaces;
    } catch (error) {
      if (ctx.signal.aborted) {
        throw error;
      }
      console.warn(`[skills] preparing a skill from ${args.source.slice(0, 200)} failed: ${error_text(error)}`);
      return result("failed", "install", "", `Could not install a skill from ${args.source.slice(0, 200)}: ${error_text(error)}`);
    }
    const files = ["SKILL.md", ...prepared.extras.map((extra) => extra.name)];
    const subject = [
      `name: ${prepared.name}`,
      `source: ${prepared.source}`,
      `description: ${prepared.description}`,
      `replaces installed skill: ${existing ? existing.name : "none"}`,
      `files: ${files.join(", ")}`,
      "SKILL.md:",
      prepared.raw,
    ].join("\n");
    const gate = await tool_gate(ctx, "install_skill", subject);
    if (gate.kind === "denied") {
      return result("denied", "install", prepared.name, gate.text);
    }
    if (gate.kind === "ask") {
      const decision = await ctx.approve({
        kind: "skill_install",
        name: prepared.name,
        description: prepared.description,
        files,
        source: prepared.source,
        replaces: existing ? existing.name : null,
        content: prepared.raw,
        ...(gate.note ? { review: gate.note } : {}),
      });
      if (decision.expired) {
        return result("denied", "install", prepared.name, unanswered_text("tool call", note_reason(gate.note)));
      }
      if (!decision.approved) {
        const feedback = decision.feedback ? ` User feedback: ${decision.feedback}` : "";
        return result("denied", "install", prepared.name, `The user declined installing the skill ${prepared.name}.${feedback}`);
      }
    }
    try {
      const installed = await commit_skill(prepared);
      return result(
        "done",
        "install",
        installed.name,
        `The skill "${installed.name}" is installed and available right now: ${installed.description}\nCall read_skill with its name to load it.`,
      );
    } catch (error) {
      console.error(`[skills] installing ${prepared.name} from ${prepared.source} failed:`, error);
      return result("failed", "install", prepared.name, `Installing the skill ${prepared.name} failed: ${error_text(error)}`);
    }
  },
});

export const skill_tools: Tool[] = [read_skill_tool, install_skill_tool];
