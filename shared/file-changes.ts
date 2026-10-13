import type { Step } from "./chat.ts";

export type FileChange = { path: string; added: number; removed: number; created: boolean };

export const file_changes = (steps: Step[]): FileChange[] => {
  const changes = new Map<string, FileChange>();
  for (const step of steps) {
    if (step.kind !== "tool" || step.status !== "done" || step.view?.kind !== "edit") {
      continue;
    }
    const view = step.view;
    const previous = changes.get(view.path);
    changes.set(view.path, {
      path: view.path,
      added: (previous?.added ?? 0) + view.added,
      removed: (previous?.removed ?? 0) + view.removed,
      created: (previous?.created ?? false) || view.created,
    });
  }
  return [...changes.values()];
};
