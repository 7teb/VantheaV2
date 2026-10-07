import { useEffect } from "react";
import { create_store, type Store } from "../state/create-store.ts";
import { use_store } from "../state/use-store.ts";

type LazyModule<T> = {
  store: Store<T | null>;
  load: () => void;
  pick: (value: T | null) => T | null;
  skip: (value: T | null) => T | null;
};

export const lazy_module = <T>(name: string, importer: () => Promise<T>): LazyModule<T> => {
  const store = create_store<T | null>(null);
  let started = false;
  const load = () => {
    if (started) {
      return;
    }
    started = true;
    importer()
      .then((module) => store.set(module))
      .catch((error) => console.error(`[markdown] loading the ${name} module failed`, error));
  };
  return { store, load, pick: (value) => value, skip: () => null };
};

export const use_lazy_module = <T>(module: LazyModule<T>, wanted: boolean): T | null => {
  const value = use_store(module.store, wanted ? module.pick : module.skip);
  useEffect(() => {
    if (wanted) {
      module.load();
    }
  }, [module, wanted]);
  return value;
};
