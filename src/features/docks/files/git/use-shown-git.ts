import type { GitView } from "../../../../../shared/git-view.ts";
import type { GitDecorations } from "../../../../../shared/git/decorations.ts";
import { files_store } from "../../../../state/files.ts";
import { decorations_of, git_store, git_view_of, shown_root } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";

export const use_shown_git = (): GitView => {
  const root = use_store(files_store, shown_root);
  return use_store(git_store, (state) => git_view_of(state, root));
};

export const use_git_decorations = (): GitDecorations | null => decorations_of(use_shown_git());
