import path from "node:path";
import { app } from "electron";
import type { ModelCatalog } from "../../shared/models.ts";
import { parse_catalog } from "./catalog.ts";
import { read_catalog_source } from "./catalog-source.ts";

let cached: Promise<ModelCatalog> | null = null;

const load = async (): Promise<ModelCatalog> => {
  const dir = path.join(app.getAppPath(), "config", "models");
  try {
    return parse_catalog(await read_catalog_source(dir));
  } catch (error) {
    cached = null;
    throw new Error(`model catalog ${dir} failed to load: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

export const model_catalog = (): Promise<ModelCatalog> => {
  cached ??= load();
  return cached;
};
