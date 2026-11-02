import { reveal_path } from "./chat-actions.ts";
import { file_link_target } from "./file-link-rules.ts";
import { shown_root } from "./files.ts";
import { show_changed_file } from "./turn-diff-ui.ts";

export const open_file_link = async (href: string) => {
  const root = await shown_root();
  const target = file_link_target(href, root?.path ?? null);
  if (!target) {
    console.warn(`[files] file link ${href.slice(0, 200)} names no file this chat can resolve`);
    return;
  }
  if (target.kind === "project") {
    show_changed_file(target.path);
    return;
  }
  reveal_path(target.path);
};
