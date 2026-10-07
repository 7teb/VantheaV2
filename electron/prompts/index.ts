import type { PermissionMode } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Personality, Settings } from "../../shared/settings.ts";
import { major_effort } from "../model/catalog.ts";
import type { Tool } from "../tools/types.ts";
import { list_top_level, load_project_doc } from "./project.ts";
import { compose_sections, major_review, render_sections, type PromptSection } from "./sections.ts";

export type { PromptSection } from "./sections.ts";

export type PromptSectionInput = { chat_id: string; project_path: string; user_text: string };

export type PromptSectionProvider = (input: PromptSectionInput) => Promise<PromptSection[]>;

let section_provider: PromptSectionProvider | null = null;

export const set_prompt_sections = (fn: PromptSectionProvider) => {
  section_provider = fn;
};

export type BuildPromptInput = {
  model: ModelEntry;
  settings: Settings;
  mode: PermissionMode;
  plan: boolean;
  personality: Personality;
  project_root: string;
  chat_id: string;
  user_text: string;
  tools: Tool[];
  has_file_attachments: boolean;
  effort: string;
};

const extra_sections = async (input: BuildPromptInput): Promise<PromptSection[]> => {
  if (!section_provider) {
    return [];
  }
  try {
    return await section_provider({ chat_id: input.chat_id, project_path: input.project_root, user_text: input.user_text });
  } catch (error) {
    console.error(`[prompts] extra section provider failed for chat ${input.chat_id}:`, error);
    return [];
  }
};

export const build_system_prompt = async (input: BuildPromptInput): Promise<string> => {
  const [project_doc, listing, extra] = await Promise.all([
    load_project_doc(input.project_root),
    list_top_level(input.project_root),
    extra_sections(input),
  ]);
  const tool_names = new Set(input.tools.map((tool) => tool.spec.name));
  const sections = compose_sections({
    model: input.model,
    mode: input.mode,
    plan: input.plan,
    personality: input.personality,
    project_root: input.project_root,
    project_doc,
    listing,
    custom_instructions: input.settings.custom_instructions,
    tool_names,
    has_file_attachments: input.has_file_attachments,
    web_depth: input.settings.web_search.depth,
  });
  const major = input.effort === major_effort && tool_names.has("deploy_agent") ? [major_review()] : [];
  return render_sections([...sections, ...major, ...extra]);
};
