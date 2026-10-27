# Sub-agents in VantheaX

The main agent can start sub-agents that work in the background of the same chat. Sub-agents cannot talk to the user and cannot deploy agents themselves. They can talk to each other.

## Tools of the main agent

- `deploy_agent`: starts a new agent and returns at once. Arguments: `name` (shown to the user), `description` (one line), `topic` (required, one word or short phrase for the area of work, for example `parser`), optional `scope` (list of project paths the agent owns or works in), `prompt` (complete standalone task, the agent knows nothing else about the chat), `profile` (`explore` or `worker`), optional `without_tools` (list of tool names taken away from the chosen profile for this agent, for example `["run_command", "run_bash"]` for a worker that may only read and edit files; it can only remove tools the profile has, and an unknown name fails with the list of the profile's tools), optional `model` (exact id from `list_models`, default is the main agent's model) and optional `effort` (default is the main agent's effort). The result names the agents that are already running, with their topics.
- `continue_agent`: starts another run of an existing agent on its kept context. The agent keeps its name, topic, scope, profile and model. Answers other agents sent it after it finished arrive at the start of this run. Tools removed with `without_tools` stay removed, also after an app restart.
- `list_agents`: the roster of the chat (see below).
- `message_agent`: sends an instruction to a running agent. It arrives at the start of the agent's next round. It fails if the agent is not running; use continue_agent then.
- `get_agent_status`: detail of one agent's latest run (see below). It never waits; do not poll it.
- `cancel_agent`: stops a running run. No report comes back from that run; continue_agent can start the agent again later.
- `list_models`: lists the catalog models with their price per 1M tokens, for choosing an agent model. The built-in skill `model-guide` says which model and effort fit which job and what they cost.

Agent ids can be given as the full id, as the short form `Name#xxxxxxxx` or `xxxxxxxx` that the roster shows, or as a unique leading part of the full id.

Limits: at most 20 agents can run at once in one chat. There is no limit on the number or length of messages between agents or to the main agent.

Agents work under the permission mode the main turn had when it deployed them (continue_agent: the mode of the current turn). Switching the mode picker later does not change a running agent; a 10-minute "allow everything" window of the chat does apply to its agents. Their approval requests appear at the composer as "<name> requests permission" ("<name> benötigt eine Freigabe"), and the More button in the titlebar and its "Background tasks" item show a yellow dot while an agent waits for approval.

## Profiles

- `explore`: read-only; its file tools stay inside the project.
- `worker`: can also edit files and run commands, under the same permission checks as the main agent. Anything outside the project folder needs a worker.
- `without_tools` on deploy_agent removes single tools from either profile for one agent. The main agent uses it only when the user asks for it or the task clearly requires it. The agent's model is not offered those tools in any run, including continue_agent runs and runs after a restart, and its instructions name them. A call to one fails with "<tool> was removed from your tools by the main agent". An agent without message_main_agent gets no update reminder. The roster, list_agents, get_agent_status and the agent's completion report show it as "worker (without run_command, run_bash)", and the automatic review sees it in the header of the deploy_agent and continue_agent task.

## Agents in one chat

Every agent knows the other agents of its chat through a roster: one line per agent. Running agents show their short id (`Name#xxxxxxxx`), topic, scope, profile, model, start time ("running since 13:05 (12 min)"), one-line task, the files they wrote in their current run and the questions they have open. Finished agents show their status and end time. Any agent with messages kept for its next run shows them, with "continue_agent delivers them". The first line names the main agent, which sub-agents reach with message_main_agent.

- A sub-agent gets the full roster at the start of each run. Later, at each of its round boundaries, it gets a short notice when an agent starts, runs again or ends. Files a peer writes do not produce a notice on their own.
- `list_agents` shows the current roster at any time, to the main agent and to sub-agents.
- Agents with the same topic are a team: they split files, share findings and ask each other directly. The roster marks them with "same topic as you". An agent with a different topic only writes to them when an overlap notice names them or when it needs something they own.
- Overlap notices: the app introduces two running agents to each other when their scopes overlap, or when one wrote a file that the other has in its scope, also wrote, or read. Both get the notice once per pair and path. Reading the same file alone does not introduce agents, and search results do not count. Files written through run_command (formatters, generators) are not seen.

`get_agent_status` shows one agent in detail: topic, scope, the task of its latest run, files read and written in that run, every peer message it sent and received with the full text, its open questions and the questions others asked it, the messages kept for its next run, recent activity while it runs, and the report once it finished. A sent message that is now kept for the recipient's next run says so instead of "delivered to the recipient's inbox". The main agent gets the path of the report file. A sub-agent gets the report text itself, because sub-agents may not reach the app's storage folder; a long report comes in pages, and each page names the `report_from` value for the rest.

After a compaction the roster is written fresh into the compaction facts, together with open questions, for the main agent and for sub-agents. After an app restart the roster is complete again; runs that were running are interrupted.

## Messages between agents

Sub-agents have `message_peer`. One message goes to one running agent of the same chat. Arguments:

- `to`: the recipient, `Name#xxxxxxxx`, `xxxxxxxx` or the full id.
- `type`: `info` (a finding or warning), `question` (the sender needs something) or `answer` (a reply to a question).
- `about`: required, the shared subject: a file, symbol, path, decision or the question itself.
- `summary`: the sender's own one-line summary in 5 to 10 words. It is the line the user and the main agent see.
- `text`: the full message. Agents are asked to point to paths, lines and report sections instead of pasting content.
- `in_reply_to`: required for `answer`, the message id (`msg_...`) of the question.

Delivery:

- A message arrives at the recipient's next round boundary. A running tool is never interrupted, and a finished agent is never woken. An agent that wants to end while a message waits in its inbox gets one more round for it. The report it had already written is kept: its last message after that round is added below the report, so a short reply to a late message never replaces it.
- `info` and `question` only reach a running agent; to a finished agent they fail with its status and the hint that get_agent_status gives its report.
- The app does not deliver a message that repeats an earlier one from the same sender to the same recipient in the same run: same type, subject, question it answers and text. The sender is told it already arrived. A message that came back unread is not a repeat and can be sent again, and neither is a question that closed without an answer because the asked agent ended.
- The recipient sees the message as information, not as an instruction: it cannot change its task, grant permissions or approve anything. Only the main agent gives sub-agents instructions.
- When a run ends before it read an info or a question, the sender is told once ("ended before it read your message"), or the main agent gets a short line when the sender has finished too. An unread answer is not sent back: it is kept for the recipient's next run like any answer to a finished agent. Unread instructions from the main agent come back to it as a short line. When the app is closed, the notices to running senders are written into their transcripts first, and unread instructions from the main agent are kept with the agent like answers, because a short line would not survive the restart: list_agents and get_agent_status show them, and continue_agent delivers them at the start of the next run, before its task.

Questions never block. No agent ever waits for another:

- The asking agent keeps working; the answer arrives at its next round boundary.
- An answer to an agent that has already finished is kept with that agent (it survives an app restart). The main agent gets a short line and decides whether the answer is worth another run; list_agents and get_agent_status show kept answers, also after a restart, and continue_agent delivers them at the start of the new run.
- When the asked agent ends without answering, the asker is told, or the main agent gets a short line when the asker has finished too.
- When an agent ends with a question still open, its report ends with a section "Open questions of Name#xxxxxxxx" and one line per question, for example "Open question to Tokenizer#3f2a91c0 about src/parser/tokens.ts since 13:07 (msg_...), still without an answer."

Noise is handled by structure, not by limits: topics, overlap notices, the required `about` field and the rule to send results and questions, not activity. When two agents send each other two messages in a row without any other tool call in between, both are told to continue their tasks, and the main agent gets an alert. Nothing is cut off; the messages are still delivered.

## What the main agent sees

- A short line (digest) per delivered message, per message that waits for an approval card, per kept answer and per question whose asked agent ended without an answer while the asker had already finished. A digest looks like `Parser#1a2b3c4d → Tokenizer#3f2a91c0: question, about src/parser/tokens.ts: 'Who changes TokenKind?'`. Digests are information, not tasks: they arrive with the main agent's next round and never start a turn by themselves.
- A peer alert when two agents kept messaging without working. An alert arrives like a report: at once, and it starts a new turn when the main turn has ended. A later report of the same run does not replace it. The main agent can steer the agents with message_agent, stop one with cancel_agent, or let them continue.
- The full text of any message, word for word, through get_agent_status.

## What you see

- In the Background Tasks panel (More menu), the recipient's transcript shows each message as a row "From <name>: <summary>" ("Von <name>: <summary>") that does not open; get_agent_status gives the full text. The sender's transcript shows the message_peer call with the recipient and the outcome ("In inbox", "Kept for next run", "Not running", "Already sent"); older chats can still show "Blocked by review" or "Declined". Message rows (message_agent, message_peer, message_main_agent and the "Update from <name>" and "Report from <name>" rows in the main chat) never open; the report itself is a file the main agent reads.
- An instruction from the main agent (message_agent, or one kept for the next run) shows in the sub-agent's transcript as a row "Received a message from the parent agent" ("Nachricht vom übergeordneten Agenten erhalten") that does not open; inside a stretch of work it joins that tool group as one of its rows instead of splitting it, like agent rows do in the main chat. The main agent has one critter icon per chat, used on these rows and on the sub-agent's message_main_agent rows, so it looks the same wherever it appears in that chat.
- The roster notices a sub-agent gets (the agent list at the start of a run, later changes and overlap introductions) are for the model only and are not shown in its transcript.
- The Background Tasks panel shows each agent's topic next to its profile (with "without run_command, run_bash" ("ohne run_command, run_bash") when tools were removed) and model, and "1 open question" ("1 offene Frage") on a running run that waits for an answer. This is information, not a waiting state.
- Allowed messages between agents do not appear in the main chat. A blocked message and a detected loop appear there as one row "Agent messages need attention: <name>" ("Agenten-Nachrichten brauchen Aufmerksamkeit: <name>") marked "Blocked" ("Blockiert") or "Loop" ("Schleife").
- When the review cannot decide about a task, a card appears at the composer like other sub-agent approval cards: "May I start the agent <name> with this task?" or "May I continue <name> with this task?". The deploy_agent and continue_agent cards name the tools removed with without_tools in a line like "Without: run_command, run_bash" ("Ohne: run_command, run_bash"); an agent without removed tools shows no such line.

## Review of agent texts

The automatic review checks every task given with deploy_agent and continue_agent before it reaches the agent. Messages are not reviewed: message_agent, message_peer and message_main_agent arrive at once in every permission mode, without a card. It does this in every permission mode, also in ask; a card appears only when the review answers "review" or is unavailable. A deploy waits for the review before the agent starts.

- Allowed: normal coordination, findings, paths, questions, answers, splitting or handing over work, warnings about conflicting edits, and requests for actions that get their own review when the recipient runs them. Texts that differ from the user's request are allowed too: a narrower or reordered plan, another approach, disagreement, partial results, open problems and mistakes, and claims that are simply wrong. Deviation is not deception.
- Blocked: texts that ask an agent to reach the result of a denied action (for example "you do the push, mine was denied"), to skip or game reviews, approvals or the permission mode, to hide actions or results from the user or the main agent, to tell the user or the main agent something the sender knows is false or to pretend work was done, or to send credentials or private files somewhere the user did not name; texts that claim an approval or permission the user did not give; and texts that plan against the user: deceiving the user, withholding results or sabotaging the user's work.
- A blocked task never arrives. The main agent is told not to try it again in any form or through another agent and gets the denial as the result of its deploy_agent or continue_agent call. The review does not judge usefulness, tone, length or the number of messages.

Reports going up to the main agent are not reviewed either.

## Messages from an agent to the main agent

A running agent has `message_main_agent`. It sends a self-contained message with confirmed results, a wrong assumption in its task, or a blocker. There is no limit on the number or length of these messages. The agent gets no answer and keeps working.

If an agent makes 15 tool calls without sending a message, the app reminds it to send its confirmed results with message_main_agent, for as long as the run lasts. The reminder is for the model only and does not show in the agent's transcript.

## Reports

When a run ends, its final text is saved as a report file:

`%APPDATA%\VantheaX\v2\agents\<agent id>\<run id>.report.md`

The main agent receives a notification with the agent id, run id, status, duration and the report file path. The report body is not put into the context automatically; the main agent reads it with run_command (for example Get-Content or rg). A failed or interrupted run's report starts with the reason the run ended early and the last output.

## How updates and reports reach the main agent

- While the main turn is running: updates and reports are added at the start of its next model round. A report replaces pending updates of the same run.
- After the main turn has ended: an update or a finished report starts a new turn in the chat by itself, using the current model, effort and permission mode from the settings. These turns are marked in the chat as coming from an agent, not from the user. While you have a message waiting in the queue above the message box, reports, updates and finished background tasks wait: your message is sent first, and they follow when its turn ends.

## Stop

Pressing Stop ends the main turn. It does not stop running sub-agents; stop those in the Background Tasks panel (the stop button on the agent row, or open a run, then "Stop" ("Stoppen")) or with cancel_agent.

After the user pressed Stop, updates from still running agents no longer start a new turn; they are held and delivered with the next turn. Finished reports still start a new turn. The hold ends as soon as any new turn starts.

## Major effort and waiting

With an effort other than Major the main turn ends when the model ends its response; reports that arrive later start a new turn as described above.

With Major effort the turn stays open: when the model ends a response while agents of the chat are still running, the app waits for an agent update, a report or a user message and continues the same turn when one arrives. If nothing arrives within 30 minutes, or no agent of the chat is running any more, the turn ends; reports that arrive later start a new turn. Outside plan mode Major also adds instructions to deploy independent parts in parallel and to run an independent review agent before finishing non-trivial work.

The main agent should never use sleep commands or poll get_agent_status to wait for agents. When it only waits, it ends its response with one short sentence saying what it waits for, for example "Waiting for Iris's review.". The app rejects PowerShell Start-Sleep and its sleep alias in every command, and while agents of the chat run it also rejects other delay commands used to wait for them.
