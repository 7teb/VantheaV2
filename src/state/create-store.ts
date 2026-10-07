export type Store<T> = {
  get: () => T;
  set: (next: T) => void;
  update: (change: (current: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
};

export const create_store = <T>(initial: T): Store<T> => {
  let state = initial;
  const listeners = new Set<() => void>();

  const set = (next: T) => {
    if (Object.is(next, state)) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    get: () => state,
    set,
    update: (change) => set(change(state)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
