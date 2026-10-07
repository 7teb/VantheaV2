import { skill_slug } from "../../skills/frontmatter.ts";
import { prepare_skill } from "../../skills/source.ts";
import { commit_skill, find_skill, installed_skill, skill_folder, usable_skills } from "../../skills/store.ts";
import { error_text } from "../../storage/coerce.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, type Tool, type ToolResult } from "../types.ts";

const max_body_chars = 100_000;

const result = (status: ToolResult["status"], action: "read" | "install", name: string, text: string): ToolResult => ({
  status,
  text,
  view: { kind: "skill", action, name },
});

const read_skill_tool = define_tool<{ name: string }>({
  spec: {
    name: "read_skill",
    description:
      "Load the full text of one installed skill by its name. The installed skills are listed with their descriptions in your system prompt; call this as soon as a task matches one of those descriptions, before you start working on it. Read-only and free, so prefer reading a matching skill over guessing the procedure yourself. If the skill ships extra documents they are listed with the absolute folder they live in: that folder is outside the open project, so read those with run_command, not read_file.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Exact skill name as listed in the installed skills section." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan", "explore", "worker"],
  available: () => usable_skills().length > 0,
  parse: (raw) => ({ name: require_string(raw, "name") }),
  run: async (_ctx, args) => {
    const skill = find_skill(args.name);
    if (!skill) {
      const names = usable_skills().map((entry) => entry.name);
      const known = names.length ? `Installed skills: ${names.join(", ")}.` : "No skills are installed.";
      return result("failed", "read", args.name, `Unknown skill "${args.name.slice(0, 120)}". ${known}`);
    }
    const body = skill.body.length > max_body_chars ? `${skill.body.slice(0, max_body_chars)}\n\n[skill text truncated]` : skill.body;
    const extras = skill.files.length ? `\nExtra files in ${skill_folder(skill.slug)}: ${skill.files.join(", ")}` : "";
    return result("done", "read", skill.name, `SKILL "${skill.name}": ${skill.description}${extras}\n\n${body}`);
  },
});

const install_skill_tool = define_tool<{ source: string }>({
  spec: {
    name: "install_skill",
    description:
      "Install a skill from a GitHub URL, a direct URL to a SKILL.md, or an absolute local path to a skill folder. The user always has to approve the exact content before anything is written, in every permission mode. Use it only when the user asked for a skill to be added. The tool result contains the installed skill's name and description, so you can read_skill it immediately in the same turn.",
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
    try {
      prepared = await prepare_skill(args.source, ctx.signal);
    } catch (error) {
      if (ctx.signal.aborted) {
        throw error;
      }
      console.warn(`[skills] preparing a skill from ${args.source.slice(0, 200)} failed: ${error_text(error)}`);
      return result("failed", "install", "", `Could not install a skill from ${args.source.slice(0, 200)}: ${error_text(error)}`);
    }
    const existing = installed_skill(skill_slug(prepared.name));
    const decision = await ctx.approve({
      kind: "skill_install",
      name: prepared.name,
      description: prepared.description,
      files: ["SKILL.md", ...prepared.extras.map((extra) => extra.name)],
      source: prepared.source,
      replaces: existing ? existing.name : null,
      content: prepared.raw,
    });
    if (!decision.approved) {
      const feedback = decision.feedback ? ` User feedback: ${decision.feedback}` : "";
      return result("denied", "install", prepared.name, `The user declined installing the skill ${prepared.name}.${feedback}`);
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
