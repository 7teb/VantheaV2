export const run_workflow_description = [
  "Run a workflow: a plain JavaScript script that orchestrates many sub-agents in the background.",
  "When to run one is set by the workflows section of your instructions.",
  "The script itself runs in an isolated sandbox without file system, network or Node access; only agents touch the world.",
  "To iterate, edit the saved script and call run_workflow with script_path and resume_from: unchanged agent() calls return their journaled results at once.",
].join(" ");

export const stop_workflow_description =
  "Stop a running workflow of this chat and every agent it started. Unfinished agent() calls end as stopped and the script stops at once; the run can be resumed later with run_workflow and resume_from, which reuses every finished agent. No result notice follows a run you stopped yourself. Use it before resuming a run that is still running, or when its work is no longer needed.";
