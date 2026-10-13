# VantheaX app reference

## Composer pickers

The model, the effort and the permission mode are app-wide settings chosen at the composer. They apply to new turns in every chat, including turns started by agent reports and background tasks.

- Model picker ("Select model" / "Modell wählen"): lists the agent models of the catalog with an "Effort" ("Aufwand") section for the chosen model.
- Mode picker ("Command permission" / "Befehlsfreigabe"): Ask (Fragen), Auto (Auto), Full auto (Voll-Auto).
- "Plan" toggle: plan mode. The agent may only read and inspect, then presents its plan with present_plan; accepting the plan starts a turn that implements it.

## Queued messages

A message sent with Enter (or the send button) while a turn runs does not go to the agent at once: it waits as a row in a panel that comes out of the top edge of the composer and is sent when the turn ends. "Steer" ("Steuern") on the row hands it to the running turn, which adds it at its next model round. Each row has "Steer" ("Steuern") while a turn runs or "Send" ("Senden") when none runs, a trash button ("Discard" / "Verwerfen") and a "..." menu with "Edit message" ("Nachricht bearbeiten"). Edit message takes the message out of the queue and puts its text and attachments back into the composer in front of anything already typed there. A row marked "Waiting for next round" ("Wartet auf nächste Runde") is already handed to the turn and cannot be edited or discarded; a row with a warning icon was not sent and can be steered, sent, edited or discarded again.

## Permission modes

The setting values are `ask`, `auto` and `full`; the UI labels are Ask ("Approve every command" / "Jeden Befehl bestätigen"), Auto ("Safe commands run, risky ask" / "Sichere laufen, riskante fragen") and Full auto ("Runs every command, including dangerous ones" / "Führt jeden Befehl aus, auch gefährliche").

- Ask: every command and every file write waits for the user's approval, except commands covered by an earlier "don't ask again for commands starting with" approval in the same chat, and the screenshots check_page saves into the page's `_shots` folder. Adding an MCP server, installing a skill, and saving or deleting a memory always ask.
- Auto: file writes inside the project run directly, except changes to AGENTS.md and CLAUDE.md, which ask. Every command, read-only ones included, is reviewed by a separate overseer model (the `side.overseer` model of the catalog) against the user's messages, custom instructions, the project instruction files and the earlier decisions of the chat; it runs if allowed, asks if the review wants the user's approval, and is refused with the reason if it breaks a rule. Parts of a command the app could not read go to the review as information; the review's verdict decides. Commands that read credential or key files always ask, and so does a script that contains a hard-blocked operation until that exact version was approved. Adding an MCP server, installing a skill, and saving or deleting a memory pass the automatic review first; allowed calls run, the rest ask or are refused.
- Full: commands, file writes and MCP tools run without asking, except dangerous tools of untrusted MCP servers. Adding an MCP server, installing a skill, and saving or deleting a memory pass the automatic review first; allowed calls run, the rest ask or are refused.
- In every mode, Ask included, texts that agents pass to sub-agents (message_peer and message_agent texts, and the tasks of deploy_agent and continue_agent) go through the automatic review before they arrive. They show a card only when the review asks for the user's approval or is unavailable; a denied text never arrives. Details are in agents.md.
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

The main agent starts long non-interactive PowerShell commands with `start_background_task` (name, command, optional project-relative cwd) and gets a task id at once. `get_background_task` reads status, exit code and the output; output over the 25000-token cap per tool result keeps its start and end, with a line saying how many characters are omitted and that redirecting the output to a file or filtering it shows them. `cancel_background_task` stops the task and its child processes. At most 16 background tasks run at once. The output survives an app restart. When a task ends and its result was not already read, a "Background task finished" ("Hintergrundaufgabe beendet") event starts a new turn in the chat once no turn is running; the event shows the last 6000 characters of the output and says how many characters before them are omitted.

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
- `side`: fixed models for side jobs: `title`, `overseer`, `vision`, `web_answer`, `memory`.
- `image_models`: models for generate_image, each with `id`, `label` and `quality`.

All model calls go through OpenRouter with the key from Settings > General.

When a model call hits a rate limit (HTTP 429), a provider outage, an interrupted stream or a timeout, the app retries it after 2, 5, 10, 20, 30, 60, 120 and 120 s, at most 9 attempts and never longer than 10 minutes after the first attempt; a Retry-After from the server is followed up to 120 s. The answer shows "Answer interrupted, attempt n/total" ("Antwort unterbrochen, Versuch n/total") meanwhile. A model with a fallback route switches to it after 3 failed attempts. Compaction calls use their own retry plan (see context.md).

## Built-in skills in the package

The built-in skills, including this one, ship as plain files in `resources\skills` next to VantheaX.exe, outside `app.asar`.
