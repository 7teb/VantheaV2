# VantheaX headless, SDK and CLI

VantheaX can run without a window and take its work from another program. The same `VantheaX.exe` starts in headless mode, opens a local HTTP API on `127.0.0.1`, runs turns with the same engine, tools, permission modes and review as the app, and hands back the streamed events and a final result. This folder holds a TypeScript SDK for that API (no runtime dependencies, Node 20 or newer) and the `vantheax` command line tool built on it.

1. [Run headless](#run-headless)
2. [Client SDK](#client-sdk)
3. [CLI](#cli)
4. [ChatGPT plan](#chatgpt-plan)
5. [Claude plan](#claude-plan)
6. [Endpoints](#endpoints)
7. [Events](#events)

## Run headless

```powershell
$env:VANTHEAX_API_TOKEN = "<at least 32 characters>"
$env:OPENROUTER_API_KEY = "<your OpenRouter key>"
.\VantheaX.exe --vx-serve --vx-lease=stdin
```

Most programs do not start it by hand: `create_vantheax` in the SDK and the CLI start it, pass a fresh token and the key, wait for the ready line and stop it again.

### Switches

| Switch | Meaning |
|---|---|
| `--vx-serve` | Start headless. Without it VantheaX starts as the normal desktop app. |
| `--vx-port=<n>` | Port of the local API, 0 to 65535. Default 0: the system picks a free port, the ready line names it. The API listens on 127.0.0.1 only. |
| `--vx-data-dir=<absolute path>` | Where this instance keeps its data. Default `%APPDATA%\VantheaX-headless`. |
| `--vx-lease=stdin` | Quit when stdin ends or closes, so the instance never outlives the program that started it. `stdin` is the only value. |

### Environment

| Variable | Meaning |
|---|---|
| `VANTHEAX_API_TOKEN` | Required, at least 32 characters. Every API request has to send it as `Authorization: Bearer <token>`. VantheaX never prints it and does not make one up. |
| `OPENROUTER_API_KEY` | The OpenRouter key for model calls. Headless mode reads the key only from here, never from the app's settings. Without it the API starts, but every turn fails with an `auth` error, except turns on OpenAI models the signed-in ChatGPT account offers while the data dir bills through the ChatGPT plan (see [ChatGPT plan](#chatgpt-plan)) and turns on Claude models while its Claude switch is on (see [Claude plan](#claude-plan)). |

Both variables are removed from the process environment at start, so shells, scripts and MCP servers that the agent starts do not inherit them.

### Ready line

Once the API listens, VantheaX writes exactly one line like this to stdout:

```json
{"vantheax":"ready","api":1,"url":"http://127.0.0.1:52817","pid":12345}
```

Log lines go to stdout too, so a client takes the first line that parses as JSON, has `"vantheax": "ready"` and a `url` of the form `http://127.0.0.1:<port>`. `create_vantheax` skips any other line, so the token it generated only goes to the loopback address. `api` is the API version (1).

### Data dir

A headless instance never shares the app's folder. A data dir equal to `%APPDATA%\VantheaX`, inside it or containing it is refused (exit code 2), also when it reaches that folder through a junction, a symbolic link or a short 8.3 name, so a headless instance never writes the chats, settings or key of the open app. Agent commands that delete or move files in the instance's data dir or in `%APPDATA%\VantheaX` hit the same command block that guards the app's own data, and neither folder can be the `cwd` of a session. In the data dir:

- `data\v2\`: settings, chats, attachments and everything else, in the same layout the app uses under `%APPDATA%\VantheaX\v2` (see the main README).
- `chromium\`: the Chromium profile of the instance.
- `documents\`: the documents folder of the instance.

A new data dir starts with the default settings. The API has no settings routes apart from the two billing switches (see [ChatGPT plan](#chatgpt-plan) and [Claude plan](#claude-plan)); the model, effort, permission mode and approval policy are chosen per session or per prompt. Only one process can use a data dir at a time. Per-chat scratchpads go to `%TEMP%\VantheaX\scratchpad\<random id>` as in the app.

### Exit codes and failures

| Code | When | stderr |
|---|---|---|
| 0 | Normal quit: the lease ended, `POST /v1/shutdown`, or SIGINT/SIGTERM | |
| 1 | A startup step failed, or an uncaught exception reached the top level while running (step `uncaughtException` or `unhandledRejection`) | `{"vantheax":"error","step":"<step>","message":"..."}` |
| 2 | Bad switches, or `VANTHEAX_API_TOKEN` missing or too short | `{"vantheax":"error","step":"launch","message":"..."}` |
| 3 | Another process already uses this data dir | `{"vantheax":"error","step":"lock","message":"..."}` |

No dialog opens in headless mode; startup failures only produce the stderr line.

### Stopping

`--vx-lease=stdin`, `POST /v1/shutdown`, SIGINT and SIGTERM all quit the same way: running turns end as `interrupted` with error kind `app_closed`, sub-agents, workflows, background tasks, terminals and MCP servers stop, the scratchpads are removed and everything is saved. Every open run then gets its `run.settled` event before the event streams close. On Windows, Node's `child.kill()` ends a process at once without running its handlers, so a program that wants a clean stop ends stdin or calls `POST /v1/shutdown`.

### What is off in headless mode

- No window, no tray icon, no dock and no dialogs.
- Scheduled tasks do not run, and the scheduled task tools are not offered to the model.
- The computer use tools are not offered to the model.
- Phone access (the LAN server) is not started.
- The browser tools stay available.

### Running next to the open app

The app and any number of headless instances can run at the same time, as long as each headless instance has its own data dir. They share nothing: the app does not see headless sessions and a headless instance does not see the app's chats. A second instance on a data dir that is in use exits with code 3.

## Client SDK

### Build it

```powershell
npm ci
npm run build:sdk
```

This writes `dist-sdk\`: `index.js`, `cli.js`, the type declarations in `types\` and a `package.json`. `dist-sdk` is an installable package named `vantheax-sdk`:

```powershell
npm install D:\path\to\VantheaX\dist-sdk
```

All names use snake_case. The SDK uses only Node built-ins and the global `fetch`.

### Start an instance and run a prompt

```ts
import { create_vantheax } from "vantheax-sdk";

const vx = await create_vantheax({ exe_path: "C:/Tools/VantheaX/VantheaX.exe" });
try {
  const session = await vx.client.sessions.create({ cwd: "D:/projects/app" });
  const result = await vx.client.run(session.id, { text: "Fix the failing test in src/parse.ts" });
  console.log(result.status, result.text);
} finally {
  await vx.close();
}
```

`create_vantheax(options)` takes:

| Option | Meaning |
|---|---|
| `exe_path` | The executable. Default: the `VANTHEAX_EXE` environment variable; without either it throws. |
| `args` | Arguments placed before the VantheaX switches, for example the app folder when the executable is a development Electron binary. |
| `data_dir` | Passed as `--vx-data-dir`. Default: the instance's default data dir. |
| `openrouter_key` | Default: `OPENROUTER_API_KEY` of the calling process. |
| `port` | Passed as `--vx-port`. Default 0. |
| `signal` | Aborting it before the instance is ready rejects the call; aborting it later closes the instance. |

It makes a random 32-byte token, starts the executable with `--vx-serve --vx-port=<port> --vx-lease=stdin` plus `--vx-data-dir` when given, waits for the ready line and returns `{ client, url, close }`. When the process exits before it is ready, the promise rejects with the exit code and what the process wrote to stderr. It also rejects when the ready line names another API version. `close()` ends stdin and resolves when the process has exited.

### Connect to a running instance

```ts
import { create_client } from "vantheax-sdk";

const client = create_client({ base_url: "http://127.0.0.1:52817", token: process.env.VANTHEAX_API_TOKEN! });
```

### Sessions and prompts

A session is a chat bound to a project folder: `sessions.create({ cwd, model?, effort?, mode?, approvals? })` needs an absolute folder that exists. The instance's own data dir and the app's `%APPDATA%\VantheaX`, and any folder inside them (also when reached through a junction), are refused as `cwd`. `sessions.list()`, `sessions.get(id)` (the whole chat with all messages) and `sessions.remove(id)` work like the app's chat list.

`client.run(session_id, body, options)` opens the session's event stream, sends the prompt and resolves once the run has settled. `body` is a `PromptRequest`: `text`, `attachment_ids?`, `plan?` and the session options `model?`, `effort?`, `mode?`, `approvals?`. `options` takes:

| Option | Meaning |
|---|---|
| `on_event(event)` | Called for every event of the session's stream, the first `hello` included. |
| `on_started(started)` | Called once the prompt is accepted, with `{ run_id, user_message_id, message_id }`. |
| `on_approval(info)` | Answers pending approvals, see [Approvals](#approvals). |
| `until` | `"idle"` (default) waits for the whole run; `"turn"` returns when the first turn has ended. |
| `signal` | Aborts the wait. It does not stop the turn; `client.stop(session_id)` does. |

`client.prompt(session_id, body)` only starts the run and returns `PromptStarted`. `client.wait(session_id, run_id, options)` waits for a run started earlier and takes the same options as `run` except `on_started`. `client.result(session_id, run_id)` reads a run's current state without waiting. Both `run` and `wait` follow the event stream and keep no HTTP request open while they wait. When the instance shuts down while they wait (its turns end `interrupted` with error kind `app_closed`), they reject with a `VantheaxError` with code `shutting_down`.

What a prompt uses, highest first: the fields of the prompt, the options given at `sessions.create`, then the defaults. The defaults are the session's last model and effort (else the default model and effort of the data dir's settings), mode `auto` and approvals `reject`. An unknown model is refused with `unknown_model`; `mode` must be `ask`, `auto` or `full` and `approvals` must be `reject` or `client`. The resulting mode, model and approval policy stay with the session, so turns that start on their own afterwards (for example when a sub-agent reports back), question answers and plan accepts use the same ones.

A prompt is refused with `409 session_busy` while the session has a running turn. `client.steer(session_id, { text })` sends a message into the running turn instead, and `client.stop(session_id)` stops it. `stop` ends the main turn and its workflows; sub-agents and background tasks of the session keep running, and a sub-agent that finishes afterwards still reports back and starts a new turn in the run.

### Runs and RunResult

A run starts with a prompt, an accepted plan or a question answer that starts a turn. Its `run_id` is the id of the assistant message the prompt created. The run includes every assistant message the session adds while it is open, such as the turn that starts when a sub-agent or background task finishes. It settles when the session is idle: no turn, no running sub-agent, workflow or background task, and nothing queued that would wake it. It also settles when the next run starts in the session. Runs are kept in memory while the instance runs and are dropped with their session. A background task that never ends, such as a dev server the model started, keeps the session from going idle, so a run waited for with `until: "idle"` stays open until that task ends or the next run starts; `until: "turn"` returns once the first turn has ended and does not wait for it.

| Field | Meaning |
|---|---|
| `run_id`, `session_id` | The ids. |
| `status` | `running` until the run settles, then the status of its last message: `done`, `stopped`, `interrupted`, `failed` or `blocked`. |
| `error` | The last message's error as `{ kind, message }`, or null. A failed turn is a result with `status: "failed"`, not an HTTP error. |
| `text` | The final answer: the text the last message wrote after its last tool call. |
| `messages` | All assistant messages of the run, with every step. |
| `needs_input.questions` | Questions the model asked with `ask_user` that are still open. |
| `needs_input.approvals` | Approvals that still wait for a reply (only with `approvals: "client"`). |
| `needs_input.plan_message_id` | The message id when the last message presented a plan that waits to be accepted, else null. |
| `active` | What still runs in the session: `{ turn, agents, workflows, background, queued }`. |
| `changed_files` | Files the file tools of the main turns changed: `{ path, added, removed, created }`. Edits made by sub-agents and workflow agents are not in it; `client.diff(session_id)` lists every changed file of the session. |
| `usage` | Prompt, completion and reasoning tokens and the number of model rounds of the run's main-turn messages. Sub-agent and workflow agent rounds are not counted. |
| `started_at`, `ended_at` | ISO times; `ended_at` is null while the run is open. |

### Events and resume

`client.events({ session_id?, last?, signal? })` is an async iterator over the server-sent events. With `session_id` only that session's events arrive. When the connection drops it reconnects at once and resumes after the last id it saw; when that reconnect fails, the iterator throws. Breaking out of the loop closes the request.

```ts
for await (const event of client.events({ session_id })) {
  if (event.type === "turn.event" && event.data.type === "text") process.stdout.write(event.data.delta);
  if (event.type === "run.settled") break;
}
```

Every event with an id can be resumed: pass it as `last` (or as `Last-Event-ID`) and the stream first replays everything after it. A `resync` event means the id is from an earlier start of the instance or no longer buffered; read the session again with `sessions.get` and carry on. `apply_event`, the reducer the app itself uses, is exported for clients that build the message state from `turn.event` data; it ignores events it has already applied.

There are two completion signals. Every turn ends with exactly one `turn.event` of type `end` that carries the final status and error. Every run ends with one `run.settled` event.

### Approvals

With `approvals: "reject"` (the default) nobody is asked: every approval the main turn or a sub-agent would wait for is denied at once and the model is told "This run has no one to approve actions, so the request was rejected. Continue without this action." The events `tool_approval` and `tool_decision` still appear, and the tool call ends `denied`. Mode `auto` runs everything the automatic review allows, so a rejected approval only happens where the review wanted a human. To let a run do everything without asking, use mode `full`.

With `approvals: "client"` the approvals wait for a reply, as in the app. Pass `on_approval` to `run` or `wait`:

```ts
const result = await client.run(session.id, { text: "Clean the build folder", approvals: "client" }, {
  on_approval: (info) => ({ approved: info.request.kind === "command" && info.request.command.startsWith("npm "), feedback: "Only npm commands" }),
});
```

`info` is an `ApprovalInfo`: `approval_id`, `source` (`main` or `agent`), `agent_id` and `run_id` for sub-agents, `call_id` and the `request` with its `kind` (`command`, `write`, `mcp`, `secret_read` and so on). The reply is `{ approved, grant?, feedback? }`; `grant` is `once` (default), `prefix`, `chat` or `session`. Each pending approval is passed to `on_approval` once. Without `on_approval`, use `client.approvals.list`, `client.approvals.reply` and `client.approvals.hold` yourself. An approval that comes from the review carries `request.expires_at`: when it passes without a reply, the step is skipped as unanswered and the model goes on without it. `approvals.hold` stops that countdown. Replying to an approval that is no longer pending gives `404 not_found`.

### Questions and plans

`ask_user` does not stop a turn: the model asks and keeps working, and the run can end `done` with the open questions in `needs_input.questions`. `client.questions.answer(session_id, [{ id, answer }])` delivers answers. When no turn runs, the answer starts a new run and the call returns its `PromptStarted`; during a turn the answer goes into the running turn and the call returns null. `client.questions.dismiss(session_id, ids)` closes questions without an answer.

A prompt with `plan: true` runs in plan mode: the agent only reads and ends with a plan. When `needs_input.plan_message_id` is set, `client.plan.accept(session_id, message_id)` starts a run that carries the plan out, with the session's mode, model and approval policy:

```ts
const planned = await client.run(id, { text: "Plan the migration to the new config format", plan: true });
if (planned.needs_input.plan_message_id) {
  const started = await client.plan.accept(id, planned.needs_input.plan_message_id);
  const done = await client.wait(id, started.run_id);
}
```

### Attachments and diffs

```ts
const image = await client.attachments.upload({ name: "error.png", mime: "image/png", bytes: await fs.readFile("error.png") });
await client.run(id, { text: "What does this error mean?", attachment_ids: [image.id] });
```

A prompt takes up to 10 attachments; images and files can be up to 20 MiB each. `client.diff(session_id)` returns the turn diff summaries of the session, `client.diff(session_id, { path })` the diff of one file.

### Errors

Every failed request throws a `VantheaxError` with `status`, `code` and `message`:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | A body, a field or a query value is wrong, or `cwd` is not an absolute existing folder. |
| 400 | `unknown_model` | The model is not in the model catalog. |
| 401 | `unauthorized` | The token is missing or wrong. |
| 403 | `forbidden_origin` | The request carries an `Origin` header, which is what browsers send. |
| 404 | `not_found` | Unknown route, session, run or approval, or no running turn to steer. |
| 409 | `session_busy` | A prompt or plan accept while a turn runs. |
| 413 | `payload_too_large` | A JSON body over 1 MiB or an upload over the attachment limit. |
| 421 | `bad_host` | The `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`. |
| 500 | `internal` | Anything else; the message says what failed. |
| 503 | `shutting_down` | A `?wait=` request that was still waiting when the instance shut down, or `run`/`wait` in the SDK when the instance shut down during the run. |

## CLI

The CLI starts VantheaX itself, so it needs the executable (`--exe` or `VANTHEAX_EXE`) and the OpenRouter key in `OPENROUTER_API_KEY`:

```powershell
$env:OPENROUTER_API_KEY = "<your OpenRouter key>"
$env:VANTHEAX_EXE = "C:\Tools\VantheaX\VantheaX.exe"
node dist-sdk\cli.js run "Explain what src/main.ts does" --cwd D:\projects\app
```

Installed from `dist-sdk` the command is `vantheax`. It sends one prompt, waits until the run has settled and prints the answer. `vantheax --help` (or `-h`, also after `run`) prints the usage and exits 0.

```
vantheax run [message..] [-] [--cwd dir] [--model id] [--effort e] [--mode ask|auto|full]
             [--session id | --continue] [--file path]... [--format text|json]
             [--exe path] [--data-dir path] [--server url]
vantheax account [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax billing api|chatgpt [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax sign-in [--fresh] [--consent] [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax sign-out [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax claude-billing api|claude [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax claude [--format text|json] [--exe path] [--data-dir path] [--server url]
vantheax --help
```

The message is the arguments joined by spaces. Without arguments the CLI reads the message from stdin. With arguments it reads stdin only when one of them is `-`, and adds the piped text after the typed message, after a blank line:

```powershell
Get-Content .\failing-test.log | vantheax run "Why does this test fail?" - --cwd .
```

When it reads stdin, the CLI reads it until it ends. A program that starts the CLI with a message argument and an open stdin pipe does not need to close it.

| Flag | Example |
|---|---|
| `--cwd` | `vantheax run "List the TODOs" --cwd D:\projects\app` (default: the current folder; only for a new session, so not together with `--session` or `--continue`) |
| `--model` | `vantheax run "Review the diff" --model deepseek/deepseek-v4.1-flash-1017` |
| `--effort` | `vantheax run "Refactor the parser" --effort high` |
| `--mode` | `vantheax run "Run the tests and fix them" --mode full` (default `auto`) |
| `--session` | `vantheax run "And now the docs" --session 5c0c0e48-91fa-40cf-b497-2a09c1247fbc` |
| `--continue` | `vantheax run "Go on" --continue` (the most recently updated session of the data dir) |
| `--file` | `vantheax run "What is wrong here?" --file .\screenshot.png --file .\app.log` |
| `--format` | `vantheax run "Summarize the changes" --format json` |
| `--exe` | `vantheax run "Hello" --exe C:\Tools\VantheaX\VantheaX.exe` (default: `VANTHEAX_EXE`; not together with `--server`) |
| `--data-dir` | `vantheax run "Hello" --data-dir D:\vantheax-ci` (not together with `--server`) |
| `--server` | `vantheax run "Hello" --server http://127.0.0.1:52817` |

Values can also be written as `--flag=value`. Without `--server` the CLI starts its own instance for this one run and stops it afterwards; the key comes from `OPENROUTER_API_KEY`. With `--server` it uses a running instance and reads the token from `VANTHEAX_API_TOKEN`. The CLI always uses the approval policy `reject`; to run without approvals, use `--mode full`. `--file` uploads each file as an attachment (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` and `.bmp` as images).

`--format text` (default) prints the answer on stdout. A line `tool: <name>` on stderr shows each tool call, and when the run did not end `done` or still needs input, stderr says so (`status: failed (bad_request: ...)`, `question: ...`, `approval pending: ...`, `plan waits for acceptance: ...`).

`--format json` prints NDJSON on stdout: one line per event of the session as it arrives (the `ApiEvent` objects from [Events](#events)), then a last line `{"type":"result","result":<RunResult>}`. When a flag is wrong, the instance does not start or a request fails, the last line is `{"type":"error","error":{"code":"...","message":"..."}}` instead.

| Exit code | Meaning |
|---|---|
| 0 | The run ended `done` and needs no input. |
| 1 | The run ended in another status, or has open questions, a pending approval or a plan to accept. |
| 2 | Wrong usage, the instance did not start, or a request failed before the prompt was accepted (for example an unknown model or session, a busy session or no token for `--server`). |
| 130 | Ctrl+C: the CLI stops the turn, waits until that turn has ended, prints its result and exits. A second Ctrl+C exits without waiting. Sub-agents and background tasks of a private instance end when the CLI closes it; with `--server` they keep running in that instance. |

### Account commands

`vantheax account` prints the billing mode and the ChatGPT sign-in of the data dir (`billing: chatgpt`, `chatgpt: signed_in (you@example.com)`, plus a line for a sign-in without plan usage or the last error), then the Claude switch and the host's Claude Code login (`claude billing: claude`, `claude: signed_in (you@example.com, max)`). `vantheax billing chatgpt` and `vantheax billing api` switch the billing mode. `vantheax sign-in` starts the ChatGPT sign-in, prints on stderr that the sign-in page was opened in the browser of the machine that runs VantheaX, follows the event stream until the sign-in has finished and prints `signed in to ChatGPT as <email>`, or the error code on stderr; `--fresh` signs in another account, `--consent` asks OpenAI again for plan usage. `vantheax sign-out` signs out and revokes the sign-in at OpenAI. `vantheax claude-billing claude` and `vantheax claude-billing api` switch the Claude models between the Claude plan and API pricing; when the plan is turned on without a signed-in Claude Code login, stderr says so and points to `vantheax claude`. `vantheax claude` reads the Claude Code login again and prints `claude: <status>` with the email and subscription; when it is not signed in, stderr carries the PowerShell login command to run on the machine that runs VantheaX (see [Claude plan](#claude-plan)). Without `--server` each command starts a private instance on `--data-dir` (or the default data dir) and stops it afterwards, so the sign-in is stored in that data dir and later `vantheax run` calls on it use it. With `--format json` each command prints one line `{"type":"account","account":<AccountInfo>}`.

| Exit code | Meaning |
|---|---|
| 0 | Done; for `sign-in` the account is signed in, for `claude` the Claude Code login is signed in. |
| 1 | The sign-in did not finish (declined, cancelled, another error), the sign-out could not confirm the revocation, `claude` found no signed-in Claude Code login, or a request failed. |
| 2 | Wrong usage or the instance did not start. |
| 130 | Ctrl+C. |

### In CI

A Windows job needs the release unzipped (see Download in the main README; here into `VantheaX`), this repository with `npm ci` and `npm run build:sdk` done (here in `vantheax-src`), and the OpenRouter key from the CI secrets in the environment (here `CI_OPENROUTER_KEY`):

```powershell
$env:OPENROUTER_API_KEY = $env:CI_OPENROUTER_KEY
$env:VANTHEAX_EXE = "$PWD\VantheaX\VantheaX.exe"
node .\vantheax-src\dist-sdk\cli.js run "Run the tests and fix what fails" --cwd . --data-dir "$env:RUNNER_TEMP\vantheax" --format json > vantheax.ndjson
if ($LASTEXITCODE -ne 0) { Get-Content vantheax.ndjson -Tail 1; exit 1 }
```

Each job gets its own data dir. The run uses mode `auto` with the `reject` policy, so a step the review would ask about is left out and the run goes on. The last line of `vantheax.ndjson` holds the `RunResult`.

## ChatGPT plan

A data dir bills the GPT models one of two ways (`billing`): `api` (the default, every call through OpenRouter with `OPENROUTER_API_KEY`, apart from the Claude models while the Claude plan is on, see [Claude plan](#claude-plan)) or `chatgpt` (calls for the OpenAI models the ChatGPT account signed in for this data dir offers go to OpenAI and count against that ChatGPT plan; every other model goes through OpenRouter with `OPENROUTER_API_KEY`). Each data dir has its own billing mode and its own sign-in, stored encrypted in the data dir; a headless instance never uses the desktop app's sign-in. Plan usage is OpenAI's sign-in for open-source tools and personal projects that run locally.

```ts
await vx.client.account.set_billing("chatgpt");
const events = vx.client.events();
await events.next();
const started = await vx.client.account.sign_in();
for await (const event of started.chatgpt.status === "signing_in" ? events : []) {
  if (event.type === "account.changed" && event.data.status !== "signing_in") {
    console.log(event.data.status, event.data.email, event.data.error);
    break;
  }
}
await events.return();
```

| Method | Route | Returns |
|---|---|---|
| `client.account.get()` | `GET /v1/account` | `AccountInfo`: `{ billing, chatgpt, claude_billing, claude }` |
| `client.account.set_billing(billing)` | `POST /v1/account/billing` | `AccountInfo` after the switch; `billing` is `api` or `chatgpt` |
| `client.account.sign_in({ fresh?, consent? })` | `POST /v1/account/chatgpt/sign_in` | `AccountInfo` with status `signing_in` once the sign-in page is open |
| `client.account.sign_out()` | `POST /v1/account/chatgpt/sign_out` | `AccountInfo` after the sign-out |

`chatgpt` is a `ChatgptAccount`: `status` (`signed_out`, `signing_in`, `signed_in` or `expired`), `email`, `name`, `plan_enabled` (whether the sign-in granted plan usage), `notice_seen` and `error` (`{ code, detail }` of the last failed attempt, or null; codes `cancelled`, `declined`, `wrong_account`, `registration_incomplete`, `token_invalid`, `network`, `storage_unavailable`, `open_failed`, `revocation_unconfirmed`). No token ever leaves the instance.

`sign_in` opens OpenAI's sign-in page in the system browser of the machine that runs VantheaX, so someone has to finish it there; the browser then returns to a loopback address on 127.0.0.1 that the instance listens on for that attempt. The call answers at once; the outcome arrives as an `account.changed` event (only streams without `session_id` get it), so open the event stream and read its `hello` before the call, as above. `fresh: true` signs in another account instead of the remembered one, `consent: true` asks OpenAI again for plan usage after a sign-in without it. Signing in never changes the billing mode. `sign_out` revokes the refresh token at OpenAI and deletes the stored tokens; when OpenAI does not confirm the revocation, the account carries the error `revocation_unconfirmed`.

With billing `chatgpt`, `GET /v1/models` lists the whole catalog as with `api`, and the default model stays the data dir's default. To run on the plan, name an OpenAI model the signed-in account offers in the prompt or at `sessions.create`: turns, sub-agents and compaction on that model run on the plan, and the side jobs and the review use the plan's own side models. While the account's model list is not loaded yet, every OpenAI model that routes to OpenAI goes to the plan and OpenAI's answer decides. An OpenAI model the account does not offer (or one that does not route to OpenAI, such as `openai/gpt-oss-120b`) and every model of another vendor run through OpenRouter with `OPENROUTER_API_KEY` and fail with the missing-key error without one. A plan error never falls back to OpenRouter; the turn ends `failed` with one of the error kinds `plan_auth` (no sign-in or an expired one), `plan_limit` (the plan's or this app's usage limit is reached, manage it at https://chatgpt.com/settings/usage), `plan_blocked` (the account or workspace may not use the plan here) or `plan_model` (the plan does not offer that model; the account's model list reloads, and once it no longer lists the model, the model runs through OpenRouter).

## Claude plan

A data dir also has its own Claude switch, `claude_billing`: `api` (the default, Claude models go through OpenRouter with `OPENROUTER_API_KEY` like every other model) or `claude` (turns, sub-agents and compaction on a Claude model run in Claude Code on the Claude subscription). The two switches are independent, so `billing: "chatgpt"` and `claude_billing: "claude"` can be on together. VantheaX ships Claude Code (the claude.exe of Anthropic's Claude Agent SDK) and runs each Claude-plan turn as a Claude Code session with VantheaX's own system prompt, tools, permission mode and approval policy; the events, run results and tool rows look the same as on the other routes, with token usage but no dollar cost.

The Claude login is not per data dir: it is the host user's own Claude Code login, which Claude Code keeps in that user's Claude folder (`%USERPROFILE%\.claude`, or `CLAUDE_CONFIG_DIR` when set). VantheaX never reads, copies or stores Claude credentials and has no sign-in route for Claude. To sign in, run the account's `login_command` (`& '<path of the bundled claude.exe>' auth login --claudeai`) in PowerShell on the machine that runs VantheaX, finish Claude Code's sign-in in the browser there, then call `refresh_claude`.

```ts
const info = await vx.client.account.set_claude_billing("claude");
const account = (await vx.client.account.refresh_claude()).claude;
if (account.status !== "signed_in") {
  console.log("run this in PowerShell on the host:", account.login_command);
}
```

| Method | Route | Returns |
|---|---|---|
| `client.account.set_claude_billing(billing)` | `POST /v1/account/claude-billing` | `AccountInfo` after the switch; `billing` is `api` or `claude` |
| `client.account.refresh_claude()` | `POST /v1/account/claude/refresh` | `AccountInfo` after the login state was read again |

`claude` is a `ClaudeAccount`: `status` (`unknown` before the first read, `missing` when the app has no Claude Code, `signed_out`, `signed_in` with the subscription login, `other_login` when Claude Code is set up with an API key, a token or a cloud provider instead, or `error` when the state could not be read), `email`, `subscription`, `auth_method`, `login_command` and `detail` (the reason of an error). The instance reads the state by running the bundled Claude Code with `auth status --json`: at start while `claude_billing` is `claude`, when it switches to `claude`, on `refresh_claude` and after a turn ended with a login error. Each change arrives as a `claude.changed` event (only streams without `session_id` get it). A turn never waits for that state; Claude Code's own answer decides.

With `claude_billing` `claude`, `GET /v1/models` lists the whole catalog as before and the default model stays the data dir's default; the switch never changes it. Name a Claude model (`anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5` or `anthropic/claude-fable-5.2`) in the prompt or at `sessions.create` to run on the plan. Side jobs and the review never run through Claude Code: they use the ChatGPT plan's side models while `billing` is `chatgpt`, otherwise OpenRouter with `OPENROUTER_API_KEY`. Consecutive Claude-plan turns of a session continue one Claude Code session; after a turn on another model, a different project folder or a session Claude Code no longer has, the next one starts a new Claude Code session that gets the stored conversation first. Claude Code keeps these sessions in the host user's Claude folder, where they also show in that user's own Claude Code; deleting a VantheaX session deletes its Claude Code session. A Claude plan error never falls back to OpenRouter; the turn ends `failed` with one of the error kinds `claude_auth` (no subscription login, or Claude Code would bill an API key), `claude_limit` (the subscription's usage limit is reached; the message names the limit and the reset time when Claude Code gives one), `claude_blocked` (the account may not use the plan right now), `claude_model` (the plan does not offer that model or effort) or `claude_process` (Claude Code did not start or exited early).

## Endpoints

Base URL: the `url` of the ready line. Every request sends `Authorization: Bearer <token>`. JSON bodies use `Content-Type: application/json` and are at most 1 MiB. The API sends no CORS headers and refuses any request with an `Origin` header, so web pages cannot call it. `:id` is a session id.

| Method | Path | Summary |
|---|---|---|
| GET | `/v1/info` | Server name, version, API version and the defaults a prompt falls back to |
| GET | `/v1/models` | Models a session can use, with their reasoning efforts |
| GET | `/v1/account` | Billing modes, the ChatGPT account of the data dir and the Claude Code login of the host |
| POST | `/v1/account/billing` | Switch model billing between API pricing and the ChatGPT plan |
| POST | `/v1/account/chatgpt/sign_in` | Open the ChatGPT sign-in in the system browser of the host; the result arrives as account.changed |
| POST | `/v1/account/chatgpt/sign_out` | Sign out of ChatGPT and revoke the stored refresh token |
| POST | `/v1/account/claude-billing` | Switch Claude model billing between API pricing and the Claude plan |
| POST | `/v1/account/claude/refresh` | Read the Claude Code login state of the host again |
| GET | `/v1/sessions` | All sessions of the data dir |
| POST | `/v1/sessions` | Create a session in an absolute, existing directory |
| GET | `/v1/sessions/:id` | One session with all messages and question states |
| DELETE | `/v1/sessions/:id` | Delete a session |
| POST | `/v1/sessions/:id/prompt` | Start a run with a prompt; 409 while a turn is active |
| GET | `/v1/sessions/:id/runs/:run_id` | Run result; wait=idle or wait=turn holds the response until it is settled |
| POST | `/v1/sessions/:id/stop` | Stop the running turn |
| POST | `/v1/sessions/:id/steer` | Send a message into the running turn |
| GET | `/v1/sessions/:id/approvals` | Pending approvals of the main turn and its agents |
| POST | `/v1/sessions/:id/approvals/:approval_id` | Approve or deny a pending approval |
| POST | `/v1/sessions/:id/approvals/:approval_id/hold` | Hold a pending approval |
| GET | `/v1/sessions/:id/questions` | Open questions the model asked |
| POST | `/v1/sessions/:id/questions` | Answer or dismiss open questions; 202 when the answer started a new run |
| POST | `/v1/sessions/:id/plan/accept` | Accept a presented plan and start a run that implements it |
| GET | `/v1/sessions/:id/diff` | Changed files of the session, or one file diff with path= |
| POST | `/v1/attachments` | Upload raw bytes as an attachment; name in x-vx-name, URI-encoded |
| GET | `/v1/events` | Server-sent events; session= filters, last= or Last-Event-ID resumes |
| POST | `/v1/shutdown` | Quit the headless instance |

Bodies and answers:

- `GET /v1/account`: answers `{ "billing": "api" | "chatgpt", "chatgpt": <ChatgptAccount>, "claude_billing": "api" | "claude", "claude": <ClaudeAccount> }`.
- `POST /v1/account/billing`: `{ "billing": "chatgpt" }` or `{ "billing": "api" }`, answers the account.
- `POST /v1/account/chatgpt/sign_in`: no body, `{}` or `{ "fresh"?: true, "consent"?: true }`, answers the account with status `signing_in` (or the error when the sign-in could not start).
- `POST /v1/account/chatgpt/sign_out`: no body, answers the account.
- `POST /v1/account/claude-billing`: `{ "billing": "claude" }` or `{ "billing": "api" }`, answers the account.
- `POST /v1/account/claude/refresh`: no body, answers the account after the Claude Code login was read again.
- `POST /v1/sessions`: `{ "cwd": "D:/projects/app", "model"?, "effort"?, "mode"?, "approvals"? }`, answers the new session.
- `POST .../prompt`: `{ "text": "...", "attachment_ids"?, "plan"?, "model"?, "effort"?, "mode"?, "approvals"? }`, answers `202 { "run_id", "user_message_id", "message_id" }`.
- `GET .../runs/:run_id`: the `RunResult`. `?wait=idle` holds the answer until the run has settled, `?wait=turn` until its first turn has ended.
- `POST .../steer`: `{ "text": "...", "attachment_ids"? }`, answers 204.
- `POST .../approvals/:approval_id`: `{ "approved": true, "grant"?, "feedback"? }`, answers 204.
- `POST .../questions`: `{ "answers"?: [{ "id", "answer" }], "dismiss"?: ["<question id>"] }`, answers 204, or `202` with `PromptStarted` when an answer started a new run.
- `POST .../plan/accept`: `{ "message_id": "..." }`, answers `202` with `PromptStarted`.
- `GET .../diff`: the turn diff summaries of the session; `?path=<file>` gives one file diff.
- `POST /v1/attachments`: the raw bytes as the body, `Content-Type` as the file type and `X-Vx-Name` as the URI-encoded file name; answers the attachment with its `id`.
- `POST /v1/shutdown`: answers 202, then the instance quits.
- `DELETE /v1/sessions/:id` and `POST .../stop` answer 204.

## Events

`GET /v1/events` sends `text/event-stream` frames with `id: <boot>.<seq>`, `event: <type>` and `data: <json>`. `?session=<id>` keeps only that session's events; `?last=<id>` or the `Last-Event-ID` header replays what came after that id. The instance keeps the newest 16 MiB of events for resuming and closes a stream that falls more than 8 MiB behind.

| Type | Data |
|---|---|
| `hello` | `{ boot, api }`, always the first frame of a stream. |
| `ping` | null, every 20 seconds, without an id. |
| `resync` | null, right after `hello` when `last` is from an earlier start or no longer buffered, without an id. |
| `turn.event` | One event of a main turn: `chat_id`, `message_id`, `seq`, `at` and its `type` (`text`, `reasoning`, `tool_call`, `tool_start`, `tool_approval`, `tool_decision`, `tool_end`, `usage`, `end` and more). |
| `session.appended` | `{ chat_id, message }`: a message was added to the session. |
| `session.updated` | The session's metadata (`id`, `title`, `streaming`, `updated_at`, ...). |
| `session.deleted` | `{ chat_id }`. |
| `questions.changed` | `{ chat_id, questions }`: the answered and dismissed states. |
| `agent.event` | One event of a sub-agent's transcript, with `agent_id` and `run_id`. A `?session=` stream gets the events of the sub-agents of that session. |
| `agents.changed` | The sub-agents of a session and their runs. |
| `agent.approvals_changed` | The pending approvals of a session's sub-agents. |
| `background.changed` | One background task of a session. |
| `account.changed` | The `ChatgptAccount` whenever it changes: a sign-in starts or ends, a sign-out, an expired sign-in. Only streams without `?session=` get it. |
| `claude.changed` | The `ClaudeAccount` whenever the host's Claude Code login state was read again. Only streams without `?session=` get it. |
| `run.settled` | `{ session_id, run_id, status }`: a run has settled. |

## Testing

`npm test` covers the contract, the API server, the SDK and the CLI without starting the app. `npm run test:headless` builds the app and the SDK, starts the development Electron binary headless with a temporary data dir and a local fake of OpenRouter, and checks the whole path: the ready line, a prompt through the SDK, events and resume, the reject policy, the token and origin checks, the CLI, the stdin lease and the data dir lock. It makes no real model calls and removes its temporary folder at the end. `npm run test:plan` does the same for the ChatGPT plan against local fakes of OpenAI and OpenRouter: the billing switch, the sign-in through a fake authorize page, the whole catalog in `GET /v1/models` once the account's model list has loaded, a tool turn over the Responses API with its request shape, the usage limit ending as `plan_limit` without any OpenRouter chat request, turns on DeepSeek and on an OpenAI model the account does not list going through OpenRouter, and the sign-out with its revocation. It never contacts OpenAI. `npm run test:claude` does the same for the Claude plan with a fake Claude Code in place of the bundled claude.exe and a fake OpenRouter: the Claude switch and the login state, a Claude-plan turn with a read_file call through VantheaX's tools with the model, system prompt and cleaned environment Claude Code receives, the next turn continuing that session, a turn on an OpenRouter model, the usage limit ending as `claude_limit` and a missing login as `claude_auth` without any Anthropic model request at OpenRouter, and the GPT switch still working. It never starts the real Claude Code.
