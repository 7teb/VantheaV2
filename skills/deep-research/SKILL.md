---
name: deep-research
description: Researching a topic across many web sources and writing it up as a sourced report, with a fixed small team of sub-agents. Load it when the user asks you to research, investigate, compare options or alternatives, survey a market, field, history or the state of something, or review studies or literature, and the answer needs several sources pulled together into a written report. Not for a single fact or a quick lookup that one or two web_search calls answer, and not for questions about this project's own code.
---

# Deep research

You coordinate. Sub-agents do the searching and the writing: researchers collect sourced notes, one report writer turns the notes into the report, and you deliver it. Do not search or write notes or the report yourself, and do not load researcher.md or report-writer.md; they are for the sub-agents and would only fill your context.

Keep the user informed with update_todos, in plain steps such as "Clarify the question", "Research", "Write the report", "Deliver". Do not mention sub-agents in those items.

## Steps

1. Ask only what changes the research
2. Choose a title and the paths
3. Split the question and fix the number of researchers
4. Deploy all researchers at once
5. At most one extra round, only for a critical gap
6. Deploy one report writer
7. Deliver the report

### 1. Ask only what changes the research

Ask with ask_user only when a missing or ambiguous detail would send the research in a different direction: a term or acronym with several meanings, a question whose answer depends on a country or jurisdiction the user did not name, a company or product name that fits several things. Otherwise start right away.

### 2. Choose a title and the paths

Pick a title of 3 to 6 words and under 50 characters, in the user's language and in sentence case, using only letters, numbers and single spaces (keep umlauts and accents as written; no hyphens, underscores or other punctuation). Example: "EU AI Act Pflichten für Startups".

All paths are relative to the project folder:
- notes: `research_notes/<title>/<topic>.md`, one file per researcher
- report: `reports/<title>.md`

write_file creates missing folders, so you do not create them yourself. Before you settle on the title, list `research_notes/` if it exists and recall the reports you delivered earlier in this chat:
- New topic: a fresh title.
- The same topic extended or updated: a title that names the topic and what is new ("EU AI Act Strafen für Startups"), or the earlier title with the next number ("EU AI Act Pflichten für Startups 2"). Note the earlier report and notes folder; the report writer gets them as background.
- The user wants the earlier research redone independently: a new title as above, without passing the earlier material on.

The title must differ from every earlier report and notes folder. Never write into an earlier request's folder.

### 3. Split the question and fix the number of researchers

Split the question into subtopics that do not overlap and together cover it, and check whether a subtopic needs separate points of view. One researcher per subtopic or point of view:

| Researchers | When | Example |
|---|---|---|
| 1 | One focused question without real parts | "Which Electron version ships Chromium 142?" |
| 3 | A focused topic with a few angles; the default when unsure | "Effects of temperature on salmon migration": biology, observed population data, climate projections |
| 4 | Distinct criteria for an evaluation or comparison | "Compare CRM platforms for small businesses": pricing, features, integrations, user reviews |
| 5 | Several separate entities, regions or domains | "AI regulation": US federal, EU AI Act, China, UK, industry self-regulation |
| 6 to 8 | A long list that needs systematic coverage | "Heat pump subsidies in all 16 German states": group the states into 6 to 8 regional clusters |

Hard limits: at most 8 researchers in this step, at most 3 more in step 5, and exactly one report writer. That is never more than 12 agents for one request. A long list gets clusters, never one researcher per item. When you build on earlier research, split only what this request adds or needs checked again.

### 4. Deploy all researchers at once

Make every deploy_agent call of this step in one response, so they run in parallel. For each researcher:

- `name`: a short name for the subtopic, `description`: one line on what it covers
- `topic`: its own short subtopic name, different for each researcher, so the researchers work independently
- `profile`: `worker`, and `without_tools`: `["run_command"]`, plus `"run_bash"` if run_bash is among your own tools. A researcher only searches, reads and writes its notes file, so it never needs a shell or a permission prompt for one.
- `scope`: `["research_notes/<title>/<topic>.md"]`
- `model`: leave it out, so the researcher runs on your own model. Set another model only when the user named one for this. Every researcher multiplies the cost, and searching and taking notes needs no stronger model than yours.
- `effort`: `medium`.
- `prompt`: exactly this shape, filled in completely, because the researcher knows nothing else about the chat:

```
Research {the narrow subtopic}.

Objective: {what the notes must cover}

Key questions:
- {specific question 1}
- {specific question 2}

Suggested sources:
- {kinds of sources to prefer: official documentation, primary data, regulators, papers, vendor pages, ...}

Constraints:
- {every bound from the user's question: time frame, region, language, budget, versions}

Save your notes with write_file to research_notes/{title}/{topic}.md (relative to the project folder).

As your first step, call read_skill with name "deep-research" and file "researcher.md", and follow it.
```

A good prompt names concrete key questions and concrete sources ("quarterly reports on the investor pages of TSMC, Samsung and Intel", not "reliable sources") and carries every constraint of the user's question ("state as of 2026, older issues marked as such").

Then end your response with one sentence that you are waiting for the research. The reports arrive by themselves; do not poll. While the researchers run, do no research of your own: no web_search, no browser, no reading of their notes files.

### 5. At most one extra round, only for a critical gap

Each researcher's report is short and names its notes file and its gaps. Read the reports, not the notes. Only if a gap would leave the report unable to answer the user's question, deploy up to 3 more researchers in one response, set up exactly like in step 4 (worker without shell tools, `model` left out, `effort` medium), and write in your response: "After these researchers finish, I will move directly to the report writer." A researcher whose notes file is missing or empty is such a gap: run it again with continue_agent or deploy a replacement in this step. Never do the research yourself. This step happens at most once. After it, whatever comes back, go to step 6.

### 6. Deploy one report writer

Deploy exactly one agent:

- `name`: "Report writer", `topic`: "report", `profile`: `worker` with the same `without_tools` as the researchers, `scope`: `["reports/<title>.md"]`
- `model`: leave it out, so the writer runs on your own model, unless the user named another; `effort`: `high`, because the synthesis is where quality counts
- `prompt`:

```
Read every notes file in research_notes/{title}/ (relative to the project folder) and write a research report that answers: {the user's full question; for a follow-up, the earlier question as amended by this request}.

Earlier research in this chat to build on: {paths of the earlier report and notes folder from step 2, or "none"}

Save the report with write_file to this exact path: reports/{title}.md

As your first step, call read_skill with name "deep-research" and file "report-writer.md", and follow it.
```

Then end your response with one sentence that you are waiting for the report.

### 7. Deliver the report

When the writer's report arrives, read `reports/<title>.md` with read_file. Answer the user with 3 to 5 sentences: the core answer, the one or two findings that matter most, and a link to the report file (`[reports/<title>.md](reports/<title>.md)`). Do not paste the whole report into the chat; it is in the file. If the report leaves part of the question open, say which part in your answer. Do not start more research after the writer has finished, unless the user asks for it.
