---
name: vantheax
description: Facts about using the VantheaX app you are running in, such as features, settings, permission modes (ask, auto, full), efforts including Major, sub-agents and their reports, background tasks, Git Bash, Undo, the task list, the turn header and folded finished turns, the composer "+" and "/" menus, dictation, /visualize, the chat archive, Initialize (AGENTS.md), Create GitHub repository (/gitinit), the memories panel, context usage and compaction, the titlebar panels (terminal, browser, files) and the More menu, the Git and GitHub view of the Files panel (status letters, Changes, History, background fetch, pull requests and checks), keep awake, where data lives under %APPDATA%\VantheaX, the model catalog, and how skills are installed and sorted into group folders. Load it when the user asks how VantheaX works, what it can do or where it keeps something. Not needed for ordinary coding work in a project; when the open project is the VantheaX source code, the code wins over this skill.
---

# VantheaX

VantheaX is a local coding agent for Windows. It is an Electron desktop app: the main process owns all state (chats, settings, agents, skills) and the window is the view. Models are reached through OpenRouter only. The agent works on the open project folder with file tools, runs PowerShell through run_command and, when Git for Windows is installed, Git Bash through run_bash, can drive an in-app browser, deploy sub-agents and start background tasks.

## Rule

Never invent features, settings, menu entries, file paths, limits or behavior of VantheaX. When a question about the app is not answered by these documents, say that you do not know, or check the VantheaX source if it is open as the project. Do not describe a feature from another product (Claude Code, Codex, Cursor) as if VantheaX had it.

The interface is English or German (Settings > General > Language). These documents quote the English label with the German one in parentheses; use the label of the user's language.

## Documents in this skill

Load one with read_skill, name `vantheax` and `file` set to the file name. This works in every agent profile and in plan mode.

- skills.md: skill folder layout, group folders, built-in skills, installing with install_skill or by hand, what gets copied, limits, skills that refer to files outside their folder.
- agents.md: deploy_agent and the other agent tools, explore and worker profiles, topics, the roster and overlap notices, messages between agents with message_peer (questions never block, kept answers), what the main agent and the user see of them, the review of agent tasks (messages are not reviewed), updates with message_main_agent, report files, how a finished main turn is woken, what Stop does, the Major wait.
- app.md: permission modes, efforts, the composer pickers, the "+" menu with skill and MCP chips, the "/" commands, dictation (the microphone button), the chat archive, the sidebar (wordmark, search, status dots on chat rows), Initialize (AGENTS.md), Create GitHub repository (/gitinit), the memories panel, queued messages, the file card and Undo, the titlebar panels (terminal, browser, files) and the More menu (background tasks with sub-agents, generated images, keep awake), the Git and GitHub view of the Files panel (status letters, the Git card, Changes, History, background fetch, the GitHub row with pull request and checks), the turn header ("Working for" / "Worked for") and folding finished turns, tool rows, tool groups with thought rows and the task list, inline visualizations (the visualize tool and the /visualize command), background tasks and "Put into background", Git Bash, the reasoning row, the web search and memory settings, where data lives, the model catalog.
- context.md: the /context panel (the context usage grid), the Auto-compact and Context limit commands, when and how the chat and sub-agents compact their context, what the model keeps afterwards, messages sent during a compaction, retries and how compaction looks.
