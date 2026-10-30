import { agent } from "./agent.ts";
import { approval } from "./approval.ts";
import { background } from "./background.ts";
import { browser } from "./browser.ts";
import { chat } from "./chat.ts";
import { commands } from "./commands.ts";
import { common } from "./common.ts";
import { composer } from "./composer.ts";
import { context } from "./context.ts";
import { dictation } from "./dictation.ts";
import { docks } from "./docks.ts";
import { files } from "./files.ts";
import { git_actions } from "./git-actions.ts";
import { git } from "./git.ts";
import { github } from "./github.ts";
import { image } from "./image.ts";
import { mcp } from "./mcp.ts";
import { memories } from "./memories.ts";
import { personalization } from "./personalization.ts";
import { plan } from "./plan.ts";
import { privacy } from "./privacy.ts";
import { projects } from "./projects.ts";
import { questions } from "./questions.ts";
import { remote } from "./remote.ts";
import { review } from "./review.ts";
import { search } from "./search.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { shortcuts } from "./shortcuts.ts";
import { sidebar } from "./sidebar.ts";
import { skills } from "./skills.ts";
import { status } from "./status.ts";
import { terminal } from "./terminal.ts";
import { time } from "./time.ts";
import { tool_label } from "./tool-label.ts";
import { tools } from "./tools.ts";
import { turn_diff } from "./turn-diff.ts";
import { web } from "./web.ts";
import { workflow } from "./workflow.ts";
import { worktree } from "./worktree.ts";

import type { MessageKey } from "../en/index.ts";

export const de: Record<MessageKey, string> = {
  ...agent,
  ...approval,
  ...background,
  ...browser,
  ...chat,
  ...commands,
  ...common,
  ...composer,
  ...context,
  ...dictation,
  ...docks,
  ...files,
  ...git,
  ...git_actions,
  ...github,
  ...image,
  ...mcp,
  ...memories,
  ...personalization,
  ...plan,
  ...privacy,
  ...projects,
  ...questions,
  ...remote,
  ...review,
  ...search,
  ...settings,
  ...shell,
  ...shortcuts,
  ...sidebar,
  ...skills,
  ...status,
  ...terminal,
  ...time,
  ...tool_label,
  ...tools,
  ...turn_diff,
  ...web,
  ...workflow,
  ...worktree,
};
