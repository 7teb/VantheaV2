# VantheaX

VantheaX is a Windows desktop app for working on code together with a language model. You open a project folder, chat with the model, and it can read and change the files in that folder, run PowerShell commands, search the web and hand bigger jobs to sub-agents running in the background.

It is built with Electron, React and TypeScript. The models come from OpenRouter, so you need your own OpenRouter API key.

## What it can do

- Read, search, edit and write files inside the project folder you picked. It stays inside that folder and never reads secret files like `.env` or SSH keys.
- Run PowerShell commands, with live output while they run. Long builds or test runs can go to the background, and the agent picks up the result when they finish.
- Plan mode: the agent only looks around and writes a plan, and nothing changes until you accept it.
- Sub-agents for work that can run in parallel or would flood the main chat. Each one has a live transcript, and they report back when they are done.
- Undo per turn, so every file the agent touched in a turn can be put back.
- A built-in terminal and a browser the agent can drive.
- Optional extras you turn on in the settings: web search through Tavily, image generation, memory across chats, skills and local MCP servers.
- English and German interface.

## Permission modes

You choose how much the agent may do on its own, right in the message box.

- **Ask**: every command and every file write waits for you.
- **Auto**: harmless read-only commands run right away. Everything else is checked by a small reviewer model, which lets safe commands through and stops risky ones for you to decide.
- **Full**: commands and writes run without asking.

A short list of truly destructive commands (formatting a drive, deleting Windows or System32, wiping boot settings) is blocked in every mode and can't be approved.

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
