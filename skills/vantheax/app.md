# VantheaX app reference

## Composer pickers

The model, the effort and the permission mode are app-wide settings chosen at the composer. They apply to new turns in every chat, including turns started by agent reports and background tasks.

- Model picker ("Select model" / "Modell wählen"): lists the agent models of the catalog with an "Effort" ("Aufwand") section for the chosen model.
- Mode picker ("Command permission" / "Befehlsfreigabe"): Ask (Fragen), Auto (Auto), Full auto (Voll-Auto).
- "Plan" toggle: plan mode. The agent may only read and inspect, then presents its plan with present_plan; accepting the plan starts a turn that implements it.

## Permission modes

The setting values are `ask`, `auto` and `full`; the UI labels are Ask ("Approve every command" / "Jeden Befehl bestätigen"), Auto ("Safe commands run, risky ask" / "Sichere laufen, riskante fragen") and Full auto ("Runs every command, including dangerous ones" / "Führt jeden Befehl aus, auch gefährliche").

- Ask: every command and every file write waits for the user's approval, except commands covered by an earlier "don't ask again for commands starting with" approval in the same chat.
- Auto: file writes inside the project run directly. Read-only commands from the allowlist run directly. Commands that read credential or key files ask. Any other command is reviewed by a separate overseer model (the `side.overseer` model of the catalog); it runs if judged safe, otherwise the user is asked.
- Full: commands, file writes and MCP tools run without asking, except dangerous tools of untrusted MCP servers. Adding an MCP server, installing a skill, saving or deleting a memory, and the first browser screenshot sent to the vision model in a chat still ask.
- In every mode some catastrophic commands are hard-blocked and cannot be approved: diskpart, bcdedit, disk-wiping cmdlets (Clear-Disk, Format-Volume, Initialize-Disk, Reset-PhysicalDisk), formatting a drive, deleting volume shadow copies, cipher /w, deleting Windows, System32, Program Files, boot files or a drive root, and deleting HKEY_LOCAL_MACHINE registry keys.
- A denial is returned to the agent with the user's reason. Approving a command can offer "Yes, and don't ask again for commands starting with: <prefix>", which applies to that chat.
- When the safety review is unavailable, a command or MCP approval can offer "Yes, and allow everything in this chat and its agents for 10 minutes". That window acts like Full for commands, file writes and read-only or state-changing MCP tools of that chat and its agents.

## Efforts

Each catalog model lists its own efforts, ordered from lowest to highest, out of: none, minimal, low, medium, high, xhigh, max. The UI labels are Off (Aus), Minimal (Minimal), Low (Niedrig), Medium (Mittel), High (Hoch), Extra high (Sehr hoch), Max (Max). Every model that has efforts also gets Major (Major).

Major is not a provider setting: the request uses the model's highest real effort. In addition, outside plan mode the main agent gets instructions to deploy independent parts to sub-agents in parallel and to run an independent review agent before it finishes non-trivial work, and while agents of the chat run, the turn waits up to 30 minutes for an agent update, a report or a user message before it ends (see agents.md).

## Titlebar

From left to right on the right side: the panel buttons Terminal, Browser, Agents and Artifacts (Artefakte), then the More menu ("More" / "Mehr", three dots), then the window controls. Each panel button opens or closes its panel.

- Terminal: terminal panel.
- Browser: the in-app browser the agent can drive.
- Agents: the sub-agents of this chat with their status; opening one shows its transcript, its report and a Stop button while it runs. A dot on the button means an agent waits for approval.
- Artifacts (Artefakte): generated images of the project, with pin, rename and export.

More menu:

- "Background tasks" ("Hintergrund-Tasks"): opens the Background Tasks panel of the current chat (running and finished tasks, output, cancel). A badge shows how many tasks of the chat are running.
- "Keep computer awake" ("Computer wach halten"), with the note "Only for this session" ("Nur für diese Sitzung"): a toggle that starts Electron's `prevent-app-suspension` power save blocker, which keeps the system from entering a low-power mode. It is not saved and is switched off when the app quits. The screen can still turn off; only system sleep is prevented.

## Background tasks

The main agent starts long non-interactive PowerShell commands with `start_background_task` (name, command, optional project-relative cwd) and gets a task id at once. `get_background_task` reads status, exit code and output tail; `cancel_background_task` stops the task and its child processes. At most 16 background tasks run at once. When a task ends and its result was not already read, a "Background task finished" ("Hintergrundaufgabe beendet") event starts a new turn in the chat once no turn is running.

## Settings

Sections: App group with General (Allgemein: Language, OpenRouter API key, Key balance) and Personalization (Personalisierung: Personality, Custom instructions, Memory); Integrations group (Integrationen) with Web search (Websuche, Tavily API key), Image generation (Bildgenerierung), MCP servers (MCP-Server) and Skills (see skills.md).

The project root may contain AGENTS.md or CLAUDE.md (checked in that order, first non-empty file wins, cut at 24000 characters). It is loaded into the system prompt as project instructions.

## Where data lives

Everything is under `%APPDATA%\VantheaX\v2`:

- `settings.json`: settings (language, model, effort, mode, projects, personality, custom instructions, memory, web search, image generation, MCP servers, MCP tool overrides, disabled skills).
- `secrets.json`: the OpenRouter and Tavily keys, encrypted with Electron safeStorage.
- `chats\`: `index.json`, `data\` and `search\`.
- `media\attachments\` and `media\images\`: attached files and generated images; `artifacts.json` lists the artifacts.
- `snapshots\`: original contents of files changed with write_file or replace_in_file in a turn, used by Undo on that turn (the newest 80 turns, at most 14 days old). Changes made through run_command are not covered.
- `background.json`: background tasks.
- `agents\<agent id>\`: agent context, run journals (`<run id>.jsonl`) and reports (`<run id>.report.md`).
- `memories.json`: memories.
- `skills\`: user skills and `installed.json`.
- `workspaces\<chat id>\`: working folder of a chat that has no project.

Files directly in `%APPDATA%\VantheaX` (outside `v2`) belong to the previous version; their settings, chats, memories, skills, artifacts and media are imported into `v2`, and the old files are left in place.

## Model catalog

The catalog is `config/models.json` inside the app (in the packaged app it is part of `resources\app.asar`, so changing it means rebuilding). It is the only place model ids are written down. It has three parts:

- `models`: the agent models. Each entry has `id` (OpenRouter id), `label`, `provider`, `provider_order`, `efforts`, `default_effort`, `vision`, `context_length`, `max_output`, optional `reasoning_passback`, optional `note` and optional `fallback` (another model id).
- `side`: fixed models for side jobs: `title`, `overseer`, `vision`, `summarize`, `web_answer`, `memory`.
- `image_models`: models for generate_image, each with `id`, `label` and `quality`.

All model calls go through OpenRouter with the key from Settings > General.

## Built-in skills in the package

The built-in skills, including this one, ship as plain files in `resources\skills` next to VantheaX.exe, outside `app.asar`.
