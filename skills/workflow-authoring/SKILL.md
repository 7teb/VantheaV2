---
name: workflow-authoring
description: The complete reference for writing a run_workflow script in VantheaX: the hooks agent, parallel, pipeline, phase, log, args and workflow with their exact semantics, the meta export, roles, structured results with schemas, worktree isolation, determinism, resume, saved workflows, quality patterns (adversarial verify, judge panels, loop-until-dry, completeness critic), scaling to the request and worked examples. Load it before you write your first workflow script in a chat, and again when a script fails in a way you do not understand.
---

# Writing workflows

A workflow is a plain JavaScript script that orchestrates many sub-agents. You write it, run_workflow runs it in the background, and its return value comes back to you as a workflow result notice. Control flow lives in code: fan-out, pipelines, barriers, loops, retries and votes happen exactly as written, so the same script with the same args always makes the same agent calls in the same order.

When to run one is set by the workflows section of your instructions: outside Major mode only when the user asks for a workflow, in Major mode also when the work fits one. Workflows fit work that splits into independent parts, needs independent verification, or is broader than one context holds. Workflows chain across turns: scout inline first (list files, scope the diff), run a workflow that pipelines over what you found, read its result, then decide the next workflow.

Typical single-phase shapes:

- Understand: parallel readers over subsystems return a structured map.
- Design: a judge panel of independent approaches, scored, synthesized from the winner.
- Review: one finder per dimension, every finding adversarially verified.
- Research: a multi-modal sweep, deep reads of the best hits, one synthesis.
- Migrate: discover the sites, transform each in its own worktree, verify each.

## Calling run_workflow

- `script`: the whole script inline. Do not write it to a file first.
- `script_path`: a script file, usually the `script.js` path an earlier result returned. Wins over `script` and `name`.
- `name`: a saved workflow, by its file name without `.js`.
- `args`: any JSON value, handed to the script verbatim as `args`. Pass arrays and objects as real JSON, never as a JSON-encoded string.
- `resume_from`: a run id (`wf_...`) of an ended run of this chat, see Resume.

The call returns at once with the run id and the saved script path. A script that does not compile fails the call with the syntax error and runs nothing. Otherwise the result arrives later on its own: never poll, sleep or predict it. stop_workflow stops a run and all its agents.

## Script shape

```js
export const meta = {
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose a fix for each',
  whenToUse: 'when CI fails intermittently',
  phases: [
    { title: 'Scan', detail: 'one agent per test folder' },
    { title: 'Fix', detail: 'one agent per flaky test' },
  ],
  roles: {
    fixer: { profile: 'worker', instructions: 'Change only the test file you are given. Run it five times after the fix.', effort: 'high' },
  },
}

const FLAKY = {
  type: 'object',
  properties: { tests: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' }, cause: { type: 'string' } }, required: ['name', 'file', 'cause'] } } },
  required: ['tests'],
}

phase('Scan')
const found = await parallel(args.folders.map((folder) => () =>
  agent(`List the tests in ${folder} that retried in the CI logs under ci-logs/. Read the logs; change nothing.`, {
    label: `scan:${folder}`, role: 'explore', schema: FLAKY,
  })))
const flaky = found.filter(Boolean).flatMap((r) => r.tests)
log(`${flaky.length} flaky tests found`)
phase('Fix')
const fixes = await parallel(flaky.map((t) => () => agent(`Fix the flaky test ${t.name} in ${t.file}. Cause from the logs: ${t.cause}`, { label: `fix:${t.name}`, role: 'fixer' })))
return { flaky, fixes }
```

Rules for `meta`:

- The script must start with `export const meta = {...}`; only comments and blank lines may come before it.
- It is read without running the script, so it must be a pure literal: objects, arrays, strings, numbers, true, false, null. No variables, function calls, spreads, computed keys or `${}` interpolation. Schemas and other constants go below meta as normal code. `const` is not hoisted: define a constant above the first line that uses it.
- `name` and `description` (one line) are required. Optional: `whenToUse`, `phases` (one `{ title, detail?, model? }` per phase, titles matched exactly by `phase()`), `roles` (see Roles). Unknown keys are an error.

Rules for the body:

- Plain JavaScript, not TypeScript: type annotations, interfaces and `as` casts are syntax errors.
- It runs as the body of one async function: `await` works at the top level and `return` gives the workflow's result. The return value must be JSON (objects, arrays, strings, numbers, booleans, null).
- No `import`, no `export` besides meta, no `require`, no `console` (use `log()`), no timers, no `fetch`, no file system, no `process`. The script runs in an isolated sandbox; only agents touch the world.
- Standard built-ins work: JSON, Math, Array, Map, Set, Promise, String and RegExp methods, `Date` with arguments, `Date.UTC`, `Date.parse`.
- `Date.now()`, `Math.random()`, `new Date()` without arguments and `Date()` throw: they would make the script non-deterministic and break resume. Pass timestamps in through `args`; get variety from prompts and labels that differ by index.

## Hooks

### agent(prompt, opts?) returns a Promise

Starts a real VantheaX sub-agent with `prompt` as its task. It is visible in the agents panel with its transcript, runs under this chat's permission mode with the normal approvals and the automatic review, and the user can skip it.

- Without `schema` it resolves to the agent's final message as a string.
- With `schema` it resolves to the validated object (see Structured results).
- It resolves to `null` when the user skips the agent or the agent ends on a terminal error (the provider failed after its retries, the run was interrupted). Always `.filter(Boolean)` before you use a list of results.
- It rejects, so `await` throws, for an unknown role or model, an unsupported or unsatisfiable schema, an invalid option, or a worktree that cannot be created. Inside `parallel` and `pipeline` that becomes `null` plus a log line.
- The agent knows nothing but its prompt, its role and the project instruction files. Write the prompt as a brief to a peer with no context: the goal, the exact files or symbols, what is already known or ruled out, what it must not touch, and exactly what to return.
- Agents are told that their final message is the return value for code, not a message to a person, so they return raw data.

Options, all optional:

- `label`: the name in the progress view and the agents panel. Default `<workflow name> #<n>`. Make labels unique and readable, for example `review:security` or `verify:${f.file}:${i}`.
- `phase`: the progress group of this agent. Use it inside `parallel` and `pipeline` stages instead of `phase()`, because concurrent stages would race on the current phase.
- `role`: `'explore'` (read-only, file tools inside the project), `'worker'` (reads, edits files, runs commands; the default), a role name from `meta.roles` or a saved role, or an inline role object `{ profile, instructions, model, effort }`.
- `schema`: a JSON Schema object for a structured result.
- `model`: a catalog model id (list_models shows them). Default: the role's model, else the chat's model. Leave it out unless a stage clearly needs another model.
- `effort`: a reasoning effort of that model, for example `low` for mechanical stages and `high` only for the hardest verify or judge stages. Default: the role's effort, else the chat's.
- `isolation: 'worktree'`: the agent works in its own git worktree on its own branch, created from the project's current commit. Use it only for agents that edit files in parallel and would otherwise conflict. A worktree the agent leaves unchanged is removed afterwards; a changed one is kept and the agent is told its path and branch, so ask the agent to commit and to return its branch name. Uncommitted work in the main folder is not in the worktree.

### parallel(thunks) returns a Promise of an array

Runs functions that return promises concurrently and waits for all of them: a barrier. A function that throws, or whose agent rejects, gives `null` at its position; `parallel` itself never rejects. Pass functions, `() => agent(...)`, so every agent starts in order; a promise is accepted too.

### pipeline(items, stage1, stage2, ...) returns a Promise of an array

Runs every item through all stages with no barrier between stages: item A can be in stage 3 while item B is still in stage 1. Each stage gets `(prev, item, index)`; the first stage's `prev` is the item itself. A stage that throws drops that item to `null` and skips its later stages. The wall-clock time is the slowest single chain, not the sum of the slowest stage per step.

### phase(title), log(...values)

`phase()` starts a progress group; later `agent()` calls without `opts.phase` land in it. Match the titles in `meta.phases` exactly. `log()` adds a narrator line to the progress view; non-string values are shown as JSON.

### args

The `args` value of the call, verbatim, or `undefined` when none was passed. One exception: when `args` arrives as a string that holds a JSON object or array, run_workflow parses it once, so the script gets the object or array. Any other string stays a string.

### workflow(nameOrRef, args?) returns a Promise

Runs another workflow inline and returns its return value: a saved name, or `{ script_path }`. It shares the parent's agents, journal and stop; its agents appear in a `▸ name` group. One level only: `workflow()` inside a child throws. An unknown name, an unreadable path, bad meta or a syntax error in the child reject.

## Pipeline by default

Use `pipeline()` for multi-stage work. A barrier, `parallel()` between stages, is right only when stage N needs cross-item context from all of stage N-1: deduplicate or merge the full result set before expensive downstream work, stop early when the total count is zero, or a prompt that compares against "the other findings". "I need to flatten, map or filter first" is not a reason (do it inside a stage), and neither are "the stages are conceptually separate" or "cleaner code".

```js
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', role: 'explore', schema: FINDINGS }),
  (review, d) => parallel((review?.findings ?? []).map((f, i) => () =>
    agent(`Try to refute this ${d.key} finding. Read the code yourself; do not trust the description.\n${JSON.stringify(f)}`, {
      label: `verify:${d.key}:${i}`, phase: 'Verify', role: 'explore', schema: VERDICT,
    }).then((v) => ({ ...f, verdict: v })))),
)
return results.flat().filter(Boolean).filter((f) => f.verdict?.real)
```

## Roles

One workflow can run explorers, builders, reviewers and judges side by side. A role is a base profile (`explore` or `worker`) plus instructions and optionally its own model and effort. The instructions go into the agent's system prompt; the task stays in the prompt.

- In the script: `meta.roles = { reviewer: { profile: 'explore', instructions: '...', model: '...', effort: 'high', description: '...' } }`, used with `role: 'reviewer'`. `explore` and `worker` cannot be redefined.
- Inline: `role: { profile: 'explore', instructions: '...' }` when the instructions are computed in code.
- Saved: a Markdown file `<project>/.vantheax/roles/<name>.md` (project) or in the user's role folder `%APPDATA%\VantheaX\v2\workflows\roles\` with frontmatter `name` (the file name), `description`, `profile` (default explore), optional `model` and `effort`; the body is the instructions.

A name resolves in this order: meta.roles, the project folder, the user folder, then explore and worker. An unknown name rejects that `agent()` call.

## Structured results

With `schema` the agent gets a `structured_result` tool whose parameters are the schema. The app validates every call; on a mismatch the agent gets each error and calls again. If it tries to end without a valid result it is reminded until it returns one. `agent()` resolves to the validated object, so you never parse text.

- The root must be `{ type: 'object', properties: {...} }`, and `required` may only name declared properties.
- Supported keywords: type (one or a list of object, array, string, number, integer, boolean, null), properties, required, additionalProperties, items, enum, const, minItems, maxItems, minLength, maxLength, minimum, maximum, pattern, anyOf, oneOf, allOf, description, title, default, examples. Anything else, `$ref` included, rejects the call before an agent starts.
- Keep schemas small and flat; put the meaning of each field in its `description`.

```js
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string', description: 'one line' },
          evidence: { type: 'string', description: 'the code and why it is wrong' },
        },
        required: ['file', 'line', 'title', 'evidence'],
      },
    },
  },
  required: ['findings'],
}
```

## Determinism and resume

Every run saves its script, its args and a journal of every `agent()` call with its result. Resume with `resume_from`: the script runs again, and the longest unchanged prefix of `agent()` calls (same prompt, same options, same role and model, in the same order) returns the journaled results at once without starting agents; the first changed or new call and everything after it runs live. Same script and same args give a full cache hit. Agents that failed, were interrupted or were stopped run again; skipped agents stay skipped.

- To change a script after a run, edit the saved `script.js` (its path is in the run_workflow result, under %APPDATA%; change it with run_command and `[IO.File]::WriteAllText`) and call run_workflow with `script_path` and `resume_from`, or pass the edited script inline together with `resume_from`.
- The run you resume from must have ended; stop it with stop_workflow first.
- After an app restart a running workflow is interrupted; resume it the same way.
- Everything that varies must come from args or agent results. Never read the clock or random numbers; sort keys deterministically when you build prompts from maps.

## Quality patterns

- Adversarial verify: for each finding, N independent skeptics are told to refute it; keep it only when the majority fails to refute. Tell skeptics to read the code themselves and to default to "not real" when they cannot confirm.
- Perspective-diverse verify: one verifier per lens (correctness, security, performance, does it reproduce) instead of N identical refuters.
- Judge panel: N independent attempts from deliberately different angles, parallel judges score each against a rubric, then one agent synthesizes from the winner and grafts the best ideas of the runners-up.
- Loop-until-dry: for unknown-size discovery, keep spawning finders until K consecutive rounds return nothing new. Deduplicate against everything seen, not only against confirmed items, or it never converges.
- Multi-modal sweep: parallel agents that search in different ways (by folder, by content, by symbol, by history).
- Completeness critic: a final agent asks what is missing; its answer becomes the next round of work.
- No silent caps: when the script bounds coverage (top N, sampling, no retry), it logs what it dropped.
- Retries in code: when a result is `null` or fails a check, run the agent again with the error in the prompt, as often as the task needs.

Scale to the request. "Find any bugs" is a few finders with single-vote verify. "Thoroughly audit this" is a larger finder pool, 3 to 5 adversarial votes per finding and a synthesis stage. There is no limit on agents, concurrency, rounds or time; only provider limits apply, and many agents at once can wait on the provider's rate limit, which their normal retry handles.

## Saved workflows

A `.js` file in `<project>/.vantheax/workflows/` (project, wins on a name clash) or in the user's folder `%APPDATA%\VantheaX\v2\workflows\saved\` is a saved workflow, run by `name` (its file name without `.js`) and by `workflow('name')` inside another script. Save a script there when the user wants to reuse it; write the project file with write_file. The system prompt lists the saved workflows with their descriptions.

## More examples

Load the file `examples.md` of this skill (read_skill with name `workflow-authoring` and file `examples.md`) for complete scripts: an exhaustive review with loop-until-dry and lens votes, a judge panel, a migration in worktrees, a research sweep, a retry loop and a nested workflow.

## Common mistakes

- Starting agents without `await` in a loop (`for (...) agent(...)` and never awaiting) loses their results; collect them with `parallel` or `pipeline`.
- Calling `phase()` inside `parallel` or `pipeline` stages: concurrent stages race on the current phase, so pass `opts.phase` there.
- Using a result without the null filter.
- Stage prompts that say "the file above" or "as discussed": every agent starts with nothing but its prompt.
- TypeScript syntax, `console.log`, `Date.now()`, `Math.random()`.
- Asking agents for prose when the next stage needs data: use a schema.
- A barrier between stages that do not need each other's full results.
