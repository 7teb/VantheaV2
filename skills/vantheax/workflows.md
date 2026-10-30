# Workflows

A workflow is a JavaScript script the main agent writes and starts with run_workflow. The script orchestrates many sub-agents in code (fan-out, pipelines, barriers, loops, votes) and returns one value, which comes back to the main agent as a workflow result notice. The authoring reference is the built-in skill workflow-authoring.

## When the agent runs one

There is no switch to turn workflows on; when the main agent runs one depends on the effort. Outside Major it runs a workflow only when the user explicitly asks for one or names a saved workflow, and splits multi-part work over sub-agents with deploy_agent instead. In Major it also prefers a workflow on its own when a task is large and splits into independent parts, needs independent verification (for example finders whose findings several skeptics try to refute), or is broader than one context holds. For one bounded task it deploys a single agent instead.

## What runs where

- The script runs in an isolated sandbox (QuickJS compiled to WebAssembly, in its own worker thread). It has no file system, network, Node or Electron access and cannot reach the permission system; only its agents touch the project.
- Every agent the script starts is an ordinary sub-agent of the chat. It runs under the chat's permission mode at the time the workflow started, asks for approvals like any agent, passes the automatic review, and appears in the agents panel with its transcript. Workflow agents do not count against the limit of 20 agents that deploy_agent can run at once.
- Roles: explore (read-only), worker (reads, edits, runs commands; the default), roles defined in the script, and saved roles in `.vantheax\roles\<name>.md` of the project or `%APPDATA%\VantheaX\v2\workflows\roles\`.
- An agent with `isolation: 'worktree'` works in its own git worktree on its own branch under `%APPDATA%\VantheaX\v2\worktrees`. An unchanged worktree is removed after the agent ends; a changed one is kept. When the app closes while such an agent runs, the next start applies the same rule to its worktree.
- No limits: no cap on agents, concurrency, rounds or run time. Many agents at once can wait on the provider's rate limit, which the normal retry handles.
- A script that still waits on something after all its agents and nested workflows have ended (for example a promise nothing resolves) ends as failed with "The script is waiting on a promise nothing can settle", instead of running forever. This is detected from the run's state, not from a time limit.
- An agent with a schema normally gets a reminder when it ends without a valid result. When the provider refused the request (a content filter or usage policy block), it is not reminded: the agent ends as failed, agent() returns null, and the agent's error shows the refusal text.

## Watching and stopping

Before a workflow starts, the script passes the automatic review like a task for an agent. When the review cannot decide or is unavailable, the card "May I run the workflow <name>?" ("Darf ich den Workflow <name> ausführen?") shows its description, the script and the args as code.

In the chat the run_workflow call is one compact tool row that never opens in place. While the workflow runs it reads "Running workflow <name>" ("Workflow <name> läuft") with the shimmer, how many agents are done ("3/17 agents", "3/17 Agenten") and the running time. Afterwards it reads "Ran workflow <name>" ("Workflow <name> ausgeführt"), "Workflow <name> failed" ("Workflow <name> fehlgeschlagen"), "Stopped workflow <name>" ("Workflow <name> gestoppt") or "Workflow <name> interrupted" ("Workflow <name> unterbrochen"), with the number of agents and the total time. A click on the row opens the Background Tasks panel at that workflow (tooltip "Show in Background Tasks", "In Background Tasks anzeigen"); a row whose run no longer exists cannot be clicked. The tool group the row sits in stays closed like any group, and while the workflow runs its head names the running workflow with its time. The turn that started the workflow keeps "Working for" ("In Bearbeitung seit") and does not fold until the workflow has ended.

In the Background Tasks panel a workflow is an entry of its own in Running or Finished, sorted with the agents and background commands by start time: its name with "Workflow" next to it, a stop button while it runs, and one row with the latest log line (or its description), its state, the agent count and its time. Its agents are not listed separately; they are inside the workflow. Clicking the row opens the workflow in the panel. Its header has a back arrow to the list, the workflow's name with its state, agent count and time, and Stop ("Stoppen") while it runs. Below, top to bottom:

- The lines the script wrote with log(). An error that parallel() or pipeline() caught shows in orange.
- The agents grouped by phase, in the order they were started: the phase title with done/total and its detail from meta, then one row per agent with a status icon (empty circle starting, spinner running, check completed or cached, slashed circle skipped or stopped, red alert failed or interrupted), its label, its role (Explore, Worker, the role name, or "Own role" ("Eigene Rolle") for a role defined inline), a status word where the icon is not enough (Starting, Waiting for approval, Cached, Skipped, Stopped, Failed, Interrupted) and its time. The reason a failed, skipped or stopped agent ended sits under its row. Hovering an agent shows its model, effort and worktree branch. Agents without a phase have no title above them.
- After the end: the script's error or the stop reason, or "Return value" ("Rückgabewert") with the start of the returned JSON (600 characters; the main agent gets the whole value).
- A footer with the counts ("2 running, 14 completed, 3 cached", "2 laufend, 14 abgeschlossen, 3 aus dem Cache") and, after the end, its end state.

When the workflow has ended, a row "Result of workflow <name>" ("Ergebnis von Workflow <name>") shows where the main agent received the result, marked Failed, Stopped or Interrupted when it did not complete. It does not open.

- Open a transcript: click an agent row in the workflow. The panel shows that agent's transcript, and its back arrow returns to the workflow. Cached agents (served from the journal on resume) and agents that never started have no transcript.
- Skip one agent: the skip button at the end of a starting or running agent's row (it appears on hover with a mouse and is always shown on touch screens). Its agent() call returns null and the script continues.
- Stop the workflow: Stop in the header of the workflow in the panel, or the stop button of its entry in the list. The script stops and every running agent of it is stopped. Pressing Stop in the chat while the main agent works stops the chat's workflows as well. The main agent learns that the workflow was stopped at its next turn; a user stop never starts a new turn by itself.
- On a phone or tablet connected over the LAN the same row, panel, skip button and Stop work; the rows get touch-sized heights and the phase details are left out on a narrow screen.
- Deleting the chat stops its workflows and deletes their data.
- Quitting the app marks a running workflow interrupted; the main agent is told at the next turn in that chat.

## Resume

Every run keeps its script, its args and a journal of every agent call with its result. Resuming (run_workflow with resume_from) runs the script again: the longest unchanged prefix of agent calls returns the saved results at once without starting agents, and the first changed or new call and everything after it runs live. Failed, interrupted and stopped agents run again. This is how the agent continues after a stop, a crash, an app restart or an edit of the script.

## Saved workflows

A `.js` file in `.vantheax\workflows\` of the project or in `%APPDATA%\VantheaX\v2\workflows\saved\` is a saved workflow. The agent sees the list with descriptions and runs one by name. Project workflows win over user workflows with the same name.

## Where the data lives

`%APPDATA%\VantheaX\v2\workflows\runs\<run id>\` holds `script.js`, `state.json` (status, phases, agents, log lines), `journal.jsonl` (every agent call and result) and `result.json` (the return value). Runs stay until their chat is deleted.
