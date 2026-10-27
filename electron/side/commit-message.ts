import type { WriteTextResult } from "../../shared/ipc/git-actions.ts";
import { git_service } from "../git/index.ts";
import { error_text } from "../storage/coerce.ts";
import { clean_git_text, commit_message_system, git_text_room, write_git_text } from "./git-text.ts";

export const write_commit_message = async (root: string): Promise<WriteTextResult> => {
  const view = git_service.repo_view(root);
  if (!view?.entries.some((entry) => entry.status !== "ignored")) {
    return { kind: "nothing" };
  }
  try {
    const material = await git_service.change_material(root, await git_text_room(commit_message_system));
    return { kind: "text", text: clean_git_text(await write_git_text(commit_message_system, material)) };
  } catch (error) {
    console.error(`[git] writing a commit message for ${root} failed:`, error);
    return { kind: "failed", error: error_text(error) };
  }
};
