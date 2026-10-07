import { agent } from "./agent.ts";
import { approval } from "./approval.ts";
import { background } from "./background.ts";
import { browser } from "./browser.ts";
import { chat } from "./chat.ts";
import { common } from "./common.ts";
import { composer } from "./composer.ts";
import { context } from "./context.ts";
import { docks } from "./docks.ts";
import { image } from "./image.ts";
import { mcp } from "./mcp.ts";
import { personalization } from "./personalization.ts";
import { plan } from "./plan.ts";
import { projects } from "./projects.ts";
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
import { web } from "./web.ts";

export const en = {
  ...agent,
  ...approval,
  ...background,
  ...browser,
  ...chat,
  ...common,
  ...composer,
  ...context,
  ...docks,
  ...image,
  ...mcp,
  ...personalization,
  ...plan,
  ...projects,
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
  ...web,
};

export type MessageKey = keyof typeof en;
