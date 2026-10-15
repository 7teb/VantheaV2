import type { AgentSummary, BackgroundTask } from "../../../../shared/ipc/work.ts";

export type TaskEntry = { kind: "agent"; agent: AgentSummary } | { kind: "shell"; task: BackgroundTask };

type TaskGroups ={ running: TaskEntry[]; finished: TaskEntry[] };

type Placed = { entry: TaskEntry; running: boolean; started: number };

const place_agent = (agent: AgentSummary): Placed => ({
  entry: { kind: "agent", agent },
  running: agent.runs.some((run) => run.status === "running"),
  started: agent.runs.reduce((latest, run) => Math.max(latest, Date.parse(run.started_at)), 0),
});

const place_task = (task: BackgroundTask): Placed => ({
  entry: { kind: "shell", task },
  running: task.status === "running",
  started: Date.parse(task.started_at),
});

export const group_tasks = (agents: AgentSummary[], tasks: BackgroundTask[]): TaskGroups => {
  const placed = [...agents.map(place_agent), ...tasks.map(place_task)].sort((left, right) => right.started - left.started);
  return {
    running: placed.filter((item) => item.running).map((item) => item.entry),
    finished: placed.filter((item) => !item.running).map((item) => item.entry),
  };
};
