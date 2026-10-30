# Workflow examples

Complete scripts that run as written. Adapt prompts, schemas and roles to the task; keep the structure.

## Review changed files across dimensions, verify each finding

Args: `{ files: ['src/a.ts', 'src/b.ts'], base: 'main' }`, found by scouting the diff first.

```js
export const meta = {
  name: 'review-changes',
  description: 'Review changed files per dimension and adversarially verify every finding',
  phases: [{ title: 'Review', detail: 'one reviewer per dimension' }, { title: 'Verify', detail: 'three skeptics per finding' }],
  roles: {
    skeptic: { profile: 'explore', instructions: 'You try to refute a reported defect. Read the code yourself and trust nothing in the report. Say real only when you can point at the exact lines that misbehave and the input that triggers it.', effort: 'high' },
  },
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'integer' }, title: { type: 'string' }, evidence: { type: 'string' } },
        required: ['file', 'line', 'title', 'evidence'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { real: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['real', 'reason'],
}
const DIMENSIONS = [
  { key: 'correctness', prompt: 'logic errors, wrong conditions, off-by-one, broken error handling' },
  { key: 'concurrency', prompt: 'races, missing awaits, state changed while an operation is in flight' },
  { key: 'security', prompt: 'injection, path traversal, secrets, trust-boundary validation' },
]
const files = args.files.join(', ')

const reviewed = await pipeline(
  DIMENSIONS,
  (d) => agent(`Review only these files changed against ${args.base}: ${files}. Look for ${d.prompt}. Report only defects you can show in the code, with file, line and evidence. An empty list is a valid answer.`, {
    label: `review:${d.key}`, phase: 'Review', role: 'explore', schema: FINDINGS,
  }),
  (review, d) => parallel((review?.findings ?? []).map((f, i) => () =>
    parallel([0, 1, 2].map((vote) => () => agent(`Refute this ${d.key} finding if you can (vote ${vote + 1}).\n${JSON.stringify(f, null, 2)}`, {
      label: `verify:${d.key}:${i}:${vote + 1}`, phase: 'Verify', role: 'skeptic', schema: VERDICT,
    }))).then((votes) => {
      const real = votes.filter(Boolean).filter((v) => v.real).length
      return { ...f, dimension: d.key, votes: votes.filter(Boolean), confirmed: real >= 2 }
    }))),
)
const all = reviewed.filter(Boolean).flat().filter(Boolean)
log(`${all.length} findings, ${all.filter((f) => f.confirmed).length} confirmed`)
return { confirmed: all.filter((f) => f.confirmed), rejected: all.filter((f) => !f.confirmed).map((f) => ({ file: f.file, line: f.line, title: f.title })) }
```

## Exhaustive bug hunt until dry, with lens votes

```js
export const meta = {
  name: 'bug-hunt',
  description: 'Hunt bugs until two rounds find nothing new, verify each through three lenses',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const BUGS = {
  type: 'object',
  properties: { bugs: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, desc: { type: 'string' } }, required: ['file', 'line', 'desc'] } } },
  required: ['bugs'],
}
const VERDICT = { type: 'object', properties: { real: { type: 'boolean' }, why: { type: 'string' } }, required: ['real', 'why'] }
const FINDERS = args.areas.map((area) => ({ area, prompt: `Find real bugs in ${area}. Return each with file, line and a one-line description.` }))
const key = (b) => `${b.file}:${b.line}`

const seen = new Set()
const confirmed = []
let dry = 0
let round = 0
while (dry < 2) {
  round += 1
  const known = [...seen].sort().join('\n') || 'none yet'
  const found = (await parallel(FINDERS.map((f) => () =>
    agent(`${f.prompt}\nAlready reported, do not report again:\n${known}`, { label: `find:${f.area}:r${round}`, phase: 'Find', role: 'explore', schema: BUGS }))))
    .filter(Boolean).flatMap((r) => r.bugs)
  const fresh = found.filter((b) => !seen.has(key(b)))
  fresh.forEach((b) => seen.add(key(b)))
  if (!fresh.length) {
    dry += 1
    log(`round ${round}: nothing new (${dry}/2)`)
    continue
  }
  dry = 0
  log(`round ${round}: ${fresh.length} new candidates`)
  const judged = await parallel(fresh.map((b) => () =>
    parallel(['correctness', 'reproduction', 'impact'].map((lens) => () =>
      agent(`Judge through the ${lens} lens whether this is a real bug: ${b.file}:${b.line} ${b.desc}`, { label: `verify:${key(b)}:${lens}`, phase: 'Verify', role: 'explore', schema: VERDICT })))
      .then((votes) => ({ bug: b, real: votes.filter(Boolean).filter((v) => v.real).length >= 2 }))))
  confirmed.push(...judged.filter(Boolean).filter((j) => j.real).map((j) => j.bug))
}
return { rounds: round, confirmed }
```

## Judge panel for a design

```js
export const meta = {
  name: 'design-panel',
  description: 'Three independent designs, three judges, one synthesis',
  phases: [{ title: 'Draft' }, { title: 'Judge' }, { title: 'Synthesize' }],
}

const SCORE = { type: 'object', properties: { scores: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 10 } }, notes: { type: 'string' } }, required: ['scores', 'notes'] }
const ANGLES = ['the smallest change that works', 'the design that scales to ten times the load', 'the design that is easiest to test']

phase('Draft')
const drafts = await parallel(ANGLES.map((angle, i) => () =>
  agent(`Design a solution for: ${args.problem}\nOptimize for ${angle}. Read the relevant code first. Return the design as concrete steps with file names.`, { label: `draft:${i + 1}`, role: 'explore' })))
const usable = drafts.map((d, i) => ({ i, text: d })).filter((d) => d.text)
const listing = usable.map((d) => `Design ${d.i + 1}:\n${d.text}`).join('\n\n')

phase('Judge')
const verdicts = (await parallel([0, 1, 2].map((j) => () =>
  agent(`Score each design from 1 to 10 against correctness, risk and effort, in the order given.\n\n${listing}`, { label: `judge:${j + 1}`, role: 'explore', schema: SCORE, effort: 'high' })))).filter(Boolean)
const totals = usable.map((d, at) => ({ ...d, total: verdicts.reduce((sum, v) => sum + (v.scores[at] ?? 0), 0) }))
totals.sort((a, b) => b.total - a.total || a.i - b.i)

phase('Synthesize')
const plan = await agent(`Write the final design from the winning design and graft the best ideas of the others.\nWinner:\n${totals[0].text}\n\nOthers:\n${totals.slice(1).map((d) => d.text).join('\n\n')}\n\nJudge notes:\n${verdicts.map((v) => v.notes).join('\n')}`, { label: 'synthesis', role: 'explore' })
return { ranking: totals.map((d) => ({ design: d.i + 1, total: d.total })), plan }
```

## Migration in worktrees

Args: `{ sites: [{ file: 'src/a.ts', symbol: 'old_api' }, ...] }`.

```js
export const meta = {
  name: 'migrate-api',
  description: 'Move every call site to the new API, each in its own worktree, and verify it',
  phases: [{ title: 'Migrate' }, { title: 'Verify' }],
}

const DONE = { type: 'object', properties: { branch: { type: 'string' }, changed: { type: 'boolean' }, tests: { type: 'string' } }, required: ['branch', 'changed', 'tests'] }
const CHECK = { type: 'object', properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'problems'] }

const results = await pipeline(
  args.sites,
  (site) => agent(`In ${site.file}, replace ${site.symbol} with new_api as described in docs/migration.md. Run the tests of that file, commit on your branch, and return your branch name, whether you changed anything and the test output summary.`, {
    label: `migrate:${site.file}`, phase: 'Migrate', isolation: 'worktree', schema: DONE,
  }),
  (done, site) => done && done.changed
    ? agent(`Check the migration of ${site.file} on branch ${done.branch}: git diff main...${done.branch}. Does it keep behavior? Return problems.`, { label: `verify:${site.file}`, phase: 'Verify', role: 'explore', schema: CHECK })
        .then((check) => ({ site, branch: done.branch, check }))
    : { site, branch: done ? done.branch : null, check: null },
)
return results.filter(Boolean)
```

## Research sweep

```js
export const meta = {
  name: 'research-sweep',
  description: 'Search a question in several ways, deep-read the best sources, write one answer',
  phases: [{ title: 'Search' }, { title: 'Read' }, { title: 'Write' }],
}

const HITS = { type: 'object', properties: { sources: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, why: { type: 'string' } }, required: ['url', 'why'] } } }, required: ['sources'] }
const MODES = ['official documentation', 'issue trackers and changelogs', 'independent benchmarks and write-ups']

phase('Search')
const hits = (await parallel(MODES.map((mode) => () =>
  agent(`Find the best sources in ${mode} for: ${args.question}. Use web_search. Return up to eight sources with why each matters.`, { label: `search:${mode}`, role: 'explore', schema: HITS }))))
  .filter(Boolean).flatMap((r) => r.sources)
const unique = [...new Map(hits.map((h) => [h.url, h])).values()]
log(`${unique.length} unique sources`)

phase('Read')
const notes = (await parallel(unique.map((s, i) => () =>
  agent(`Read ${s.url} and extract what it says about: ${args.question}. Quote the key sentences and note the date.`, { label: `read:${i + 1}`, role: 'explore', effort: 'low' })))).filter(Boolean)

phase('Write')
return agent(`Answer: ${args.question}\nUse only these notes and cite the URLs:\n\n${notes.join('\n\n---\n\n')}`, { label: 'write', role: 'explore' })
```

## Retry in code and loop until a count

```js
export const meta = { name: 'collect-cases', description: 'Collect ten reproducible failing cases' }

const CASE = { type: 'object', properties: { input: { type: 'string' }, output: { type: 'string' }, reproduced: { type: 'boolean' } }, required: ['input', 'output', 'reproduced'] }
const cases = []
let attempt = 0
while (cases.length < 10) {
  attempt += 1
  const known = cases.map((c) => c.input).join('\n') || 'none'
  const found = await agent(`Find one input that makes tools/parse.py crash. Run it to confirm. Known inputs, find a different one:\n${known}`, { label: `case:${attempt}`, schema: CASE })
  if (found && found.reproduced) {
    cases.push(found)
  }
  log(`${cases.length}/10 after ${attempt} attempts`)
}
return cases
```

## Nested workflow

A saved workflow `review-changes` runs as one step of a larger script:

```js
export const meta = { name: 'release-check', description: 'Review the release diff, then write the release notes' }

const review = await workflow('review-changes', { files: args.files, base: args.base })
const notes = await agent(`Write release notes for ${args.version} from these files: ${args.files.join(', ')}. Mention these confirmed fixes: ${JSON.stringify(review.confirmed)}`, { label: 'notes', role: 'explore' })
return { review, notes }
```
