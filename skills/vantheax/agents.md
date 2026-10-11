# Sub-agents in VantheaX

The main agent can start sub-agents that work in the background of the same chat. Sub-agents cannot talk to the user and cannot deploy agents themselves.

## Tools of the main agent

- `deploy_agent`: starts a new agent and returns at once. Arguments: `name` (shown to the user), `description` (one line), `prompt` (complete standalone task, the agent knows nothing else about the chat), `profile` (`explore` or `worker`), optional `model` (exact id from `list_models`, default is the main agent's model) and optional `effort` (default is the main agent's effort).
- `continue_agent`: starts another run of an existing agent on its kept context. The agent keeps its name, profile and model.
- `message_agent`: sends an instruction to a running agent. It arrives at the start of the agent's next round. It fails if the agent is not running; use continue_agent then.
- `get_agent_status`: snapshot of the latest run (status, runtime, tool calls, recent output, report file path once finished). It never waits; do not poll it.
- `cancel_agent`: stops a running run. No report comes back from that run; continue_agent can start the agent again later.
- `list_models`: lists the catalog models with their price per 1M tokens, for choosing an agent model.

Limits: at most 8 agents can run at once in one chat.

Agents work under the permission mode the main turn had when it deployed them (continue_agent: the mode of the current turn). Switching the mode picker later does not change a running agent; a 10-minute "allow everything" window of the chat does apply to its agents. Their approval requests appear at the composer as "<name> requests permission" ("<name> benötigt eine Freigabe"), and the Agents button in the titlebar shows a dot while an agent waits for approval.

## Profiles

- `explore`: read-only; its file tools stay inside the project.
- `worker`: can also edit files and run commands, under the same permission checks as the main agent. Anything outside the project folder needs a worker.

## Messages from an agent to the main agent

A running agent has `message_main_agent`. It sends a short self-contained message (at most 4000 characters) with confirmed results, a wrong assumption in its task, or a blocker. At most 10 messages per run. The agent gets no answer and keeps working.

If an agent makes 15 tool calls without sending a message, the app reminds it to send its confirmed results with message_main_agent (only while it has messages left).

## Reports

When a run ends, its final text is saved as a report file:

`%APPDATA%\VantheaX\v2\agents\<agent id>\<run id>.report.md`

The main agent receives a notification with the agent id, run id, status, duration and the report file path. The report body is not put into the context automatically; the main agent reads it with run_command (for example Get-Content or rg). A failed or interrupted run's report starts with the reason the run ended early and the last output.

## How updates and reports reach the main agent

- While the main turn is running: updates and reports are added at the start of its next model round. A report replaces pending updates of the same run.
- After the main turn has ended: an update or a finished report starts a new turn in the chat by itself, using the current model, effort and permission mode from the settings. These turns are marked in the chat as coming from an agent, not from the user.

## Stop

Pressing Stop ends the main turn. It does not stop running sub-agents; stop those in the Agents panel (open an agent, then "Stop" ("Stoppen")) or with cancel_agent.

After the user pressed Stop, updates from still running agents no longer start a new turn; they are held and delivered with the next turn. Finished reports still start a new turn. The hold ends as soon as any new turn starts.

## Major effort and waiting

With an effort other than Major the main turn ends when the model ends its response; reports that arrive later start a new turn as described above.

With Major effort the turn stays open: when the model ends a response while agents of the chat are still running, the app waits for an agent update, a report or a user message and continues the same turn when one arrives. If nothing arrives within 30 minutes, or no agent of the chat is running any more, the turn ends; reports that arrive later start a new turn. Outside plan mode Major also adds instructions to deploy independent parts in parallel and to run an independent review agent before finishing non-trivial work.

The main agent should never use sleep commands or poll get_agent_status to wait for agents. When it only waits, it ends its response without text. The app rejects PowerShell Start-Sleep and its sleep alias in every command, and while agents of the chat run it also rejects other delay commands used to wait for them.
