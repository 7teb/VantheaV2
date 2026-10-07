import { useEffect, useState } from "react";
import type { ModelCatalog } from "../../../../shared/models.ts";
import { api } from "../../../api/bridge.ts";

export type CatalogState = { status: "loading" } | { status: "ready"; catalog: ModelCatalog } | { status: "failed" };

let cached: ModelCatalog | null = null;

export const use_catalog = (): CatalogState => {
  const [state, set_state] = useState<CatalogState>(cached ? { status: "ready", catalog: cached } : { status: "loading" });
  useEffect(() => {
    if (cached) {
      return;
    }
    let alive = true;
    api
      .invoke("models:catalog")
      .then((catalog) => {
        cached = catalog;
        if (alive) {
          set_state({ status: "ready", catalog });
        }
      })
      .catch((error) => {
        console.error("[settings] models:catalog failed", error);
        if (alive) {
          set_state({ status: "failed" });
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
};
