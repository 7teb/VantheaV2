export type Release = () => void;

export type Gate = { enter: (shared: boolean) => Promise<Release> };

type Waiter = { shared: boolean; admit: () => void };

export const create_gate = (): Gate => {
  const waiting: Waiter[] = [];
  let shared_running = 0;
  let exclusive_running = false;

  const admit_waiting = () => {
    while (waiting.length && !exclusive_running) {
      const head = waiting[0];
      if (!head.shared && shared_running > 0) {
        return;
      }
      waiting.shift();
      if (head.shared) {
        shared_running += 1;
        head.admit();
        continue;
      }
      exclusive_running = true;
      head.admit();
      return;
    }
  };

  const release = (shared: boolean): Release => () => {
    if (shared) {
      shared_running -= 1;
    } else {
      exclusive_running = false;
    }
    admit_waiting();
  };

  return {
    enter: (shared) =>
      new Promise<Release>((resolve) => {
        waiting.push({ shared, admit: () => resolve(release(shared)) });
        admit_waiting();
      }),
  };
};
