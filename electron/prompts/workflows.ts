import type { PromptSection } from "./sections.ts";

const sizing =
  "Size the workflow to the request: \"look for bugs\" is a few finders with one verifier each, \"audit this thoroughly\" is a larger finder pool, three to five adversarial votes per finding and a synthesis stage.";

const when_normal = [
  "Run a workflow only when the user explicitly asks for one or names a saved workflow. A task that is large or splits into several parts is not such a request: deploy its independent parts with deploy_agent, in parallel in one response, and do small work yourself.",
  sizing,
].join(" ");

const when_major = [
  "Major mode is on, so prefer a workflow over separate deploy_agent calls when it fits: when a task is large and splits into independent parts (one agent per file, module, subsystem or review dimension), when its result needs independent verification (finders whose findings skeptics try to refute, judge panels over competing designs), or when it is broader than one context holds (audits, migrations, sweeps across a codebase). A single deploy_agent is enough for one bounded delegated task, and small work you do yourself. Run a workflow whenever the user asks for one.",
  sizing,
].join(" ");

export const workflows = (major: boolean): PromptSection => ({
  title: "workflows",
  body: [
    "run_workflow runs a workflow: a plain JavaScript script that orchestrates many sub-agents in the background and returns one value. Control flow lives in code, so loops, fan-out, pipelines, barriers, retries and votes happen exactly as written, and the same script with the same args makes the same agent calls in the same order.",
    major ? when_major : when_normal,
    "Before you write your first script in a chat, load the workflow-authoring skill with read_skill and follow it. Scout first when the work list is unknown (list the files, scope the diff) and pass the list in args; let the script pipeline over it. For large work, run several workflows in sequence and read each result before you decide the next phase.",
    "The tool returns at once with the run id and the saved script path. The return value arrives on its own as a workflow result notice: while your turn runs it is injected into your context, after your turn ended it starts a new turn. Never poll, sleep or guess the result. When you have nothing else to do meanwhile, end your response with one short sentence that says you are waiting for the workflow.",
    "Agents of a workflow are real sub-agents of this chat under its permission mode, approvals and automatic review; the user sees them in the agents panel, can skip one and can stop the run. A workflow has no limit on agents, concurrency, rounds or time. Only provider limits apply: many agents at once can hit the provider's rate limit, which the normal retry absorbs; say so when the user wonders why agents wait.",
    "A result notice with status failed, stopped or interrupted is unfinished work: read the error, fix the script or its inputs and resume with resume_from, which returns every finished agent's journaled result at once. Present the workflow's findings as what the agents reported, check what matters before you rely on it, and say what stayed unverified.",
  ].join("\n\n"),
});
