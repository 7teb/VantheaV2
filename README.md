# VantheaX

VantheaX is a Windows desktop app for working on code together with a language model. You open a project folder, chat with the model, and it can read and change the files in that folder, run PowerShell commands, search the web and hand bigger jobs to sub-agents running in the background.

It is built with Electron, React and TypeScript. The models come from OpenRouter, so you need your own OpenRouter API key.

## What it can do

- Read, search, edit and write files inside the project folder you picked. It stays inside that folder and never reads secret files like `.env` or SSH keys. While the model is still writing a file or an edit, you can open its row and watch the new text come in line by line.
- Run PowerShell commands, with live output while they run. Long builds or test runs can go to the background, and the agent picks up the result when they finish.
- Plan mode: the agent only looks around and writes a plan, and nothing changes until you accept it.
- Questions while it works: the agent can ask you something above the message box without stopping. Pick an answer, write your own or close the question; your answer reaches the running turn, or starts a new one when it is done.
- Sub-agents for work that can run in parallel or would flood the main chat. Each one has a live transcript, and they report back when they are done. When an agent needs your approval, the question shows up above the message box and the agent is marked with a yellow dot, so you don't have to open each transcript.
- Undo per turn, so every file the agent touched in a turn can be put back.
- A built-in terminal and a browser the agent can drive.
- Optional extras you turn on in the settings: web search through Tavily, image generation, memory across chats, skills and local MCP servers.
- Skills: built-in skills ship with the app and are on by default: one about VantheaX itself and `effects-lab` (group `design`), which builds visual effect pages and composed ads and checks them in a headless Edge or Chrome (needs Python with Pillow and Node 22 or newer) (they can be turned off, not removed). Your own skills live in the skills folder, one folder per skill with a `SKILL.md`, and can be sorted into group folders one level deep, for example `designs\glow\SKILL.md`.
- English and German interface.

## Permission modes

You choose how much the agent may do on its own, right in the message box.

- **Ask**: every command and every file write waits for you.
- **Auto**: the agent just works on what you asked for. Every command, background task and MCP tool call first goes past an automatic review model, which checks it against your messages, your custom instructions, the project's `AGENTS.md` and `CLAUDE.md` and the earlier decisions in the chat. Normal steps inside the project, like builds, tests, installing the project's dependencies or local git commits, run on their own. Anything beyond that, like deleting files outside the project, installing software system-wide, pushing or uploading, or running something downloaded, waits for your yes, and something your rules forbid is refused with the reason. Changes to `AGENTS.md` or `CLAUDE.md` also wait for your yes. Sub-agents follow the same rules.
- **Full**: commands and writes run without asking.

When you say no, that sticks: the review sees your earlier answers and refuses the same command, or another way to the same result, until you write something new in the chat. "Don't ask again for commands starting with ..." skips the question only where the review would have asked; a refusal by the review still stands. It works for the rest of the chat, also after a restart. If the review can't be reached or doesn't answer in time, you are asked instead of anything running unchecked. To let the chat and its sub-agents run without questions for ten minutes, pick "Full auto for 10 minutes" in the permission menu; the message box shows the time left and can end it early.

A short list of truly destructive commands (formatting a drive, deleting Windows or System32, wiping boot settings) is blocked in every mode and can't be approved. If such a command is hidden inside a script the agent wants to run, you are asked first, even when the review would let it through.

## Building it

You need:

- Windows (built and used on Windows 10)
- Node.js 22.18 or newer (I use 24)
- An OpenRouter API key from https://openrouter.ai/keys
- Optionally a Tavily key if you want web search

Then:

```powershell
git clone https://github.com/7teb/VantheaV2.git
cd VantheaV2
npm ci
npm run package
```

The finished app lands in `outputs\electron\win-unpacked\`. Start `VantheaX.exe` from there. That folder contains everything the app needs, so you can move it wherever you like.

If you prefer an installer, run `npm run dist` instead. It writes `VantheaX Setup <version>.exe` to `outputs\electron\`.

This repository only holds what is needed to build the app. The dev server script and the test suite are not part of it, so `npm run dev` and `npm test` won't work here.

## First start

1. Open the settings with Ctrl+,.
2. Paste your OpenRouter key under General. It is stored encrypted through Windows' data protection.
3. If you want web search, add your Tavily key under Web search.
4. Pick a model in the message box, choose a project folder in the sidebar and start chatting.

The model list, including context and output limits, lives in `config/models.json`.

## Where your data goes

Settings, chats, attachments, generated images, memories, skills, agent transcripts and undo snapshots are stored in `%APPDATA%\VantheaX\v2\`. Nothing leaves your machine except the requests to OpenRouter and to the services you turn on yourself.
