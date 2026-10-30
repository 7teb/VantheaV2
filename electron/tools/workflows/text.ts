export const run_workflow_description = [
  "Run a workflow: a plain JavaScript script that orchestrates many sub-agents in the background. Control flow (fan-out, pipelines, barriers, loops, retries, votes) lives in code instead of your judgment, so the same script with the same args makes the same agent calls in the same order.",
  "Before you write your first script in a chat, load the workflow-authoring skill with read_skill and follow it: it has the hooks and their exact semantics, the meta rules, roles, structured results, determinism, resume, quality patterns and worked examples.",
  "When to run one is set by the workflows section of your instructions. Scout first when the work list is unknown, then pass it in args.",
  "The tool returns at once with the run id and the saved script path. The workflow runs in the background and its return value arrives automatically as a workflow result notice; never poll, sleep or predict the result.",
  "Every agent the script starts is a real sub-agent of this chat: it runs under this chat's permission mode with the normal approvals and the automatic review, shows in the agents panel, and the user can skip it or stop the whole run. The script itself runs in an isolated sandbox without file system, network or Node access; only agents touch the world. There is no limit on the number of agents, their concurrency, rounds or time; only provider limits apply, such as rate limits that the normal retry handles.",
  "To iterate, edit the saved script and call run_workflow with script_path and resume_from: unchanged agent() calls return their journaled results at once.",
].join(" ");

export const stop_workflow_description =
  "Stop a running workflow of this chat and every agent it started. Unfinished agent() calls end as stopped and the script stops at once; the run can be resumed later with run_workflow and resume_from, which reuses every finished agent. No result notice follows a run you stopped yourself. Use it before resuming a run that is still running, or when its work is no longer needed.";
