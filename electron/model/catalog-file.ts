import { readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { ModelCatalog } from "../../shared/models.ts";
import { parse_catalog } from "./catalog.ts";

let cached: Promise<ModelCatalog> | null = null;

const load = async (): Promise<ModelCatalog> => {
  const file = path.join(app.getAppPath(), "config", "models.json");
  try {
    return parse_catalog(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    cached = null;
    throw new Error(`model catalog ${file} failed to load: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

export const model_catalog = (): Promise<ModelCatalog> => {
  cached ??= load();
  return cached;
};
