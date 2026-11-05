# Scheduled tasks

A scheduled task ("Scheduled tasks" / "Geplante Aufgaben") is a prompt that VantheaX runs again and again on a fixed schedule. Example: "check every hour how hot it gets in Africa and tell me when something changes". The user creates tasks on the Scheduled tasks page, or the model creates them with the save_scheduled_task tool. A run tells the user only when it found something new.

## Where tasks show

- Sidebar: "Scheduled tasks" sits directly under New chat at the top left. It opens the Scheduled tasks page in the main area (the message box is not shown there). While a task runs, the entry shows the three purple dots on the right; while a run waits for an approval, a yellow dot instead.
- Page: the heading "Scheduled tasks" with the number of tasks and "New task" ("Neue Aufgabe"). Tasks that are on come first, then the section "Paused" ("Pausiert") with the tasks that are off, each section oldest first. Without tasks the page shows "No scheduled tasks" ("Keine geplanten Aufgaben") over a clock dial and a "New task" button. While the list loads, gray placeholder cards show; when it cannot load, "Scheduled tasks could not be loaded" with Retry.
- Each task is a card. Clicking the card opens the task's chat. On the left a ring counts down to the next run: the text in its middle is the time left (for example `23m`, `5h`, `6d`, or `now`), the ring fills as the run comes closer, and its tooltip gives the clock time ("Next run 15:00" / "Nächster Lauf 15:00"). Only the task that runs next on the page has a white ring. A running task shows three purple dots in the ring, a run that waits for an approval a yellow dot, a task that is off a pause sign and a dashed ring. Next to it: the name, two lines of the prompt, then the model with its effort, the project or "No project", and "Full auto" ("Voll-Auto") with a red shield only when the task runs in Full mode (Ask and Auto are not printed). Top right: "Run now" ("Jetzt ausführen", a play button that shows on hover; disabled while the task's chat has a turn going), the on/off switch and "..." with Edit ("Bearbeiten") and Delete ("Löschen"). A task that is off is dimmed.
- Card footer: the run trail, small bars for the last twelve runs, oldest left. A low gray bar is a quiet run, a tall purple one a run with new activity, a tall red one a failed run, an outlined one a stopped run, and a pulsing white one the run that is going right now; each bar has a tooltip with its result and time. Next to it the last result: "Running" with the running time, "Waiting for approval" ("Wartet auf Freigabe"), "New activity" ("Neue Ereignisse", with a purple dot while its chat is unread), "No new activity" ("Keine neuen Ereignisse"), "Failed" ("Fehlgeschlagen"), "Stopped" ("Gestoppt") or "Not run yet" ("Noch nicht gelaufen"), with the time it ended. "Failed" is a button that opens the error. On the right the schedule in words ("Every hour" / "Stündlich").
- Each task chat lists in the sidebar like any chat, in its project or under No project, with a small calendar-clock mark before its title (dimmer while the task is off). Renaming the chat renames the task.

## Creating and editing in the UI

"New task" opens the dialog with:

- Name ("Name") and Prompt ("Prompt"): both required; Create stays disabled until both are filled.
- Schedule ("Zeitplan"): 1 h, 2 h, 24 h or 7 d (every hour, every 2 hours, every 24 hours, every 7 days). Nothing else is possible.
- Model ("Modell"): the same menu as the model picker of the message box, models and their efforts. Default: the current default model and effort. Pro and Flex of an existing task stay while its model stays the same and are dropped when another model is picked.
- Project ("Projekt"): "No project" or one of the projects. Default: the project open in the window.
- Command permission ("Befehlsfreigabe"): Ask, Auto or Full auto. Default: the global permission mode.

"Create task" ("Aufgabe erstellen") creates the task and its chat; Save ("Speichern") stores an edit. The dialog has no on/off switch: a new task starts on, and the card's switch turns it on and off. Delete asks first ("Delete scheduled task?" / "Geplante Aufgabe löschen?"); the task's chat stays in the sidebar as an ordinary chat with its run history. Deleting the chat deletes its task. A paired phone can do the same with tasks as with MCP servers.

## When tasks run

- Only while VantheaX runs, also while it sits in the system tray. Nothing runs while the app is closed.
- The first run starts right away after the task is created; it is the baseline later runs compare against. Later runs follow the schedule counted from the creation time.
- On app start a task whose run time has passed runs once, as soon as the configured MCP servers have started (so the run has their tools); missed runs are never repeated. The same happens after sleep or a clock change: VantheaX compares the clock with the stored time of the next run, and a run that fell due runs once.
- When the task's chat still has a turn going (a previous run, or a message the user sent) when the next run is due, that run is skipped. Run now is unavailable while that chat has a turn going.
- Turning a task on again or changing its schedule puts the next run on the schedule counted from the last run.
- Every run is a new turn in the task's chat with the task's model, effort, Pro or Flex and permission mode, in the task's project. There is no extra round limit, timeout or output limit. Approvals inside a run follow the task's permission mode like any turn: Ask shows the card in the task chat, Auto and Full go through the automatic review.
- An archived task chat stays archived through quiet runs; a run with new activity or a failure brings it back into the sidebar.

## What a run gets and what it answers

The run's message is the task prompt. Before it the model gets a hidden app note: this is an unattended scheduled check, do not ask questions, work quickly with the tools you have, and (when web search is not set up) look things up with the built-in browser. From the second run on the note tells it to compare with the earlier runs in this chat and, when nothing relevant is new, to answer with exactly `NO_NEW_ACTIVITY` and nothing else. When something is new, its answer starts with one plain sentence that says what is new.

## How runs look in the task chat

- A run opens with a divider line "Scheduled task · 14:00" ("Geplante Aufgabe · 14:00"; other days with the weekday or the date) instead of a message bubble; clicking it shows the prompt.
- A run with new activity or a failed run follows as a normal turn with its answer or error.
- A quiet run shrinks to one line "No new activity · 13:00"; clicking it shows the tool calls of that run. Several quiet runs in a row become one line "No new activity · 6 runs since 08:00" ("Keine neuen Ereignisse · 6 Läufe seit 08:00") that opens to the single runs.

## Notifications

- A run with new activity: a Windows notification titled with the task name, its text the first line of the answer. Clicking it brings the window back (also from the tray) and opens the task chat. The task chat gets the purple unread dot and moves up in the sidebar, and while VantheaX is in the background the notification sound plays when it is on (Settings > General > Notifications).
- A quiet run: no notification, no sound, no unread dot, and the chat keeps its place in the sidebar.
- A failed run, or a run that could not start (for example its model is gone or its project folder is missing): one notification with the error. Further failures in a row stay silent until a run succeeds again.
- A run that waits for an approval: a notification that the task waits for the user.
- Windows notifications only show while the VantheaX window is not in front; while it is, the unread dot and the sound do that job. Windows may not show notifications for the unpacked app without a Start menu entry.

## The model's tools

The main agent has list_scheduled_tasks, save_scheduled_task and delete_scheduled_task (not in plan mode and not for sub-agents).

- list_scheduled_tasks lists every task with its id, name, schedule, on or off, model, mode, project, next run and last run.
- save_scheduled_task creates a task (name, prompt and schedule `1h`, `2h`, `24h` or `7d`) or changes one by id (name, prompt, schedule, enabled). A task the model creates takes the model, effort, Pro or Flex, permission mode and project of the chat it is created in (no project for a chat without one). The model cannot change a task's model, permission mode or project; only the user can, in the dialog.
- delete_scheduled_task deletes a task by id; its chat stays.
- Every change goes through the permission mode: in Ask mode a card asks first ("May I create this scheduled task?" / "Darf ich diese geplante Aufgabe erstellen?") with the name, schedule, permission, model, project and prompt; in Auto and Full the automatic review decides and may still ask.

## Where the data lives

`%APPDATA%\VantheaX\v2\scheduled-tasks.json` holds the tasks: id, the task chat, prompt, schedule, on or off, model choice, permission mode, the next run time, the last run with its result and error, and the last twelve run results for the trail. The task's name and project are the title and project of its chat in `chats\`.
