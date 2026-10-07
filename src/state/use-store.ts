import { useRef, useSyncExternalStore } from "react";
import type { Store } from "./create-store.ts";

type Cached<T, S> = { state: T; selector: (state: T) => S; value: S };

export const use_store = <T, S>(store: Store<T>, selector: (state: T) => S): S => {
  const cache = useRef<Cached<T, S> | null>(null);
  const snapshot = () => {
    const state = store.get();
    const cached = cache.current;
    if (cached && cached.state === state && cached.selector === selector) {
      return cached.value;
    }
    const value = selector(state);
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, snapshot);
};
