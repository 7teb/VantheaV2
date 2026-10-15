export const init_request_text = [
  "Set up AGENTS.md for this project: inspect the project, then create AGENTS.md in the project root, or update it if it already exists.",
  "Read what defines the project before you write anything: the README, package and build manifests, scripts, CI configuration, test setup, linter and formatter configs, and existing instruction files such as AGENTS.md and CLAUDE.md. Look at the source layout and a few representative source files.",
  "AGENTS.md is for a coding agent that starts work in this project. Cover:",
  "- Commands: install, build, run, test (also how to run a single test), lint and format, exactly as the project defines them.",
  "- Layout: the main directories and files and what each one holds.",
  "- Conventions the code actually follows: language and framework versions, naming, formatting, error handling, how tests are written.",
  "- Gotchas: generated files that must not be edited by hand, required tools or environment variables, platform specifics, slow or flaky steps.",
  "Write only what you verified in the files or by running a command; leave out anything you would have to guess, and never invent a command. Keep it concise and specific to this project: short sections, no generic advice, no restating what the README already explains at length.",
  "If AGENTS.md already exists, keep the rules and instructions a person wrote there, correct facts that are wrong or outdated, and add what is missing. Stay consistent with CLAUDE.md if the project has one. Change no other file. When you are done, say in a few lines what AGENTS.md now covers and what you changed.",
].join("\n");
