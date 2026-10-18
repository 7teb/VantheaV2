# Context and compaction in VantheaX

## Context usage

The ring at the composer shows how full the model's context window is, with the same number the automatic compaction checks (see below): everything the next request carries, system prompt, tools, history, tool outputs and delivered messages, but not the unsent draft in the composer. It updates before every model call, after every round once its tool outputs are in, and after every compaction, so it already shows the value that starts a compaction. Clicking it opens "Context usage" ("Kontext-Auslastung") with "<used> of <limit> tokens (<percent>%)", a bar and the button "Compact now" ("Jetzt komprimieren"), which is disabled while a turn runs. The slash command Compact ("/compact") does the same from the composer. The context limit and the auto-compaction point are set with the "/" commands in the composer, not in this popup. "Context limit" ("Kontextlimit") offers "Model maximum" ("Modellmaximum") with the model's window, then the presets 1M, 400k, 272k, 200k, 128k, 64k and 32k tokens that are below that window; a limit set earlier that is not a preset stays in the list. "Auto-compact" ("Auto-Komprimierung") offers 50, 60, 70, 80, 90 and 95% of the current model's limit, each with its token point ("at 140k tokens" / "bei 140k Tokens"), 70% by default, and keeps a value set earlier in the list. The current choice is checked, and both rows show the current value and the model it belongs to, for example "70% for GPT 6 Luna". A small mark on the bar shows where compaction starts. The setting is stored per model and applies to every turn and every sub-agent that uses that model: the app then treats the limit as the model's window for the ring, compaction and trimming, so requests stay below it, for example below a provider's higher price tier. A sub-agent has its own ring in the header of its transcript in the Background Tasks panel, left of Stop and the close button: it shows that agent's own context window with the same popup, without "Compact now", because sub-agents compact on their own.

Every catalog model has its own `context_length` in `config/models.json`; all thresholds below are fractions of that window, not fixed token counts.

## When it compacts

Before every model call of a turn, after new user messages and agent reports are added, the app measures the request. Above 70% of the model's window it compacts first. The 70% and the window are per model and can be changed with the "/" commands Auto-compact and Context limit (see above); every number in this section then uses those values. After a compaction that worked and brought the context below 70%, the next one fires again at 70%. After one that worked but still left the context above 70%, the next one waits until the context has grown by another 10% of the window, and that raised threshold carries over to the next turn as long as the model stays the same. After one that failed for good, the rest of that turn does not try again, but the next turn tries again at 70%.

The measure is based on the provider's own token count. After every model call the app stores the provider's prompt token count together with its own estimate of the same request (about four characters per token). The next request is measured as its estimate times that ratio, so the provider count of the last request plus everything added since, scaled the same way. The ratio is stored with the chat (for a sub-agent with its run) and is used from the first check of the next turn on, also after an app restart, after "Continue", when a sub-agent is continued and for "Compact now". It is only used for the model that produced it: after a model switch the first check uses the plain estimate against the new model's window, and switching back reuses the old ratio. The first turn of a chat, and a chat saved before this measure existed, also start with the plain estimate.

The same applies to every sub-agent, read-only explore agents included.

## How it compacts

The working model writes its own handoff note. It gets exactly the context the model works with, nothing shortened, plus the request to write the note as the last message. The call repeats the last round exactly (same messages, tools, tool choice and effort) and only adds that request at the end, so the provider's prompt cache covers the whole context and the note costs about as much as one cached round. The request itself says not to call tools; if the model calls one anyway, the note is asked for once more with tools turned off. There is no separate summarizing model, no cap on the note's length and no time limit on the call; only the stream's normal stall detection applies.

The request goes out whole as long as it fits into the context window. Only if the note comes back cut off because the window had no more room for it, the oldest tool outputs are removed from the request until it fits into 90% of the window, so a tenth stays free for the note, the request names each removed output, and it is sent again. When the request alone would not fit the window (for example an old chat replayed in full for the first time), the oldest tool outputs are removed up front until it fits. The app measures that with an estimate; if the provider still answers "context window exceeded", the next oldest output is removed and the request is sent again at once, one output per rejection, until it fits or no tool output is left. The working context itself keeps every output.

The request asks for a factual handoff, not a new plan: user instructions and approvals kept apart from the agent's own decisions and proposals, related values (a file and its hash, an agent ID with its run ID and report path) kept together, consequential facts kept even when old, incidents with their exact error, the latest explicit next step unchanged, and no guessed gaps.

- Model: the chat's model, or the sub-agent's own model.
- Effort: the effort the chat or the sub-agent runs with, the same as its rounds.
- Sections of the note: TASK, DECISIONS, RULES, STATE, FILES, FAILED, NEXT. A sub-agent's note also has FINDINGS, and its TASK is the task the main agent gave it.

## What the model sees afterwards

1. The system prompt.
2. A notice that the context was compacted, followed by the note. The notice says that entries marked (user) in DECISIONS and RULES are binding unless a newer user message says otherwise (for a sub-agent: entries marked (delegated task), unless a newer message from the main agent or the user says otherwise), that the model's own earlier decisions stand unless new concrete evidence shows they were wrong, and that files must be read again before editing.
3. Every user message of the chat word for word (for a sub-agent: its task and the messages from the main agent or the user).
4. The last 10 rounds of the agent word for word. The newest round, the assistant message with all its tool outputs, is always kept whole, even when it alone takes more than 30% of the window; the 30% budget (counted with the newest round) and the 10-round count only decide how many older rounds stay, oldest dropped first.
5. A block the app builds itself: the files changed in this chat or run, and the last 10 commands with their status.

The chat itself keeps every message on screen; only the request to the model is shortened. The note is stored with the chat (for a sub-agent with its run) and is used on later turns too.

A tool result is cut once, when it arrives, at 25000 tokens. After that every request carries it exactly as stored until the next compaction, in old turns as in recent ones. A request to the working model loses tool outputs only when it would not fit into the context window at all; then the oldest ones are removed as far as needed and the chat shows a notice. An image over a provider's documented size limit for one image (for example the 2000 px per side Anthropic allows once a request carries more than 20 images) is scaled down until it fits, with a line after it saying from which size to which and why. Images the app cannot rescale (GIF, WebP), and images beyond a provider's limit on the number of images or the size of the whole request, are left out with a notice, oldest first.

## Messages sent during a compaction

A message the user sends while a compaction runs is not part of the compaction. It is held and sent right after the compaction finishes or finally fails. During a manual compaction it stays in the queue above the composer marked "Sends after compaction" ("Wird nach der Komprimierung gesendet"); pressing "Steer" ("Steuern") on a queued message does the same. Such a message can still be discarded, and Stop works the whole time.

## Errors and retries

Every error of the compaction call is caught. The app retries after 2 s, 5 s and 10 s, then every 60 s, at most 14 attempts in total, and the turn waits meanwhile. From the first failed attempt on, the line keeps saying "Compacting context, attempt n of 14" and adds the reason with a countdown to the next try, for example "rate limited · retrying in 42s" ("Rate-Limit erreicht · neuer Versuch in 42 s"). A "context window exceeded" error is not retried after a wait; it removes the next oldest tool output from the request as described above, and once no tool output is left to remove it counts as failed for good. Errors that waiting cannot fix (an invalid API key, no credits or a reached key limit, a content policy refusal, a request the provider rejects as invalid) end the compaction at once without retries; an empty note is retried like a temporary error. Stop ends the wait at once.

If the last attempt fails, an automatic compaction falls back to dropping old tool results and the turn continues; a manual compaction shows the failed line and nothing else.

## How it looks

Compaction shows as one plain line in the chat and in the agent transcript, not as a tool row; it cannot be opened and does not show the note.

- Running: "Compacting context" ("Kontext wird komprimiert"); after 10 s with "This can take a few minutes" ("Das kann einige Minuten dauern"); on a retry "Compacting context, attempt n of 14".
- Done: "Context automatically compacted" ("Kontext automatisch komprimiert") or, after Compact now, "Context compacted" ("Kontext komprimiert").
- Waiting for a retry: the running text, still moving, followed by "<reason> · retrying in <n>s" ("<Grund> · neuer Versuch in <n> s").
- Failed or interrupted: "Context compaction failed" ("Kontext-Komprimierung fehlgeschlagen") or "Compaction interrupted" ("Komprimierung unterbrochen").
