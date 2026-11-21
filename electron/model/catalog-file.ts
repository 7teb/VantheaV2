import path from "node:path";
import { app } from "electron";
import type { ModelCatalog } from "../../shared/models.ts";
import { parse_catalog, parse_plan_side, type PlanSide } from "./catalog.ts";
import { read_catalog_source } from "./catalog-source.ts";

type CatalogFile = { catalog: ModelCatalog; plan_side: PlanSide };

let cached: Promise<CatalogFile> | null = null;

const load = async (): Promise<CatalogFile> => {
  const dir = path.join(app.getAppPath(), "config", "models");
  try {
    const source = await read_catalog_source(dir);
    const catalog = parse_catalog(source);
    return { catalog, plan_side: parse_plan_side(source, catalog) };
  } catch (error) {
    cached = null;
    throw new Error(`model catalog ${dir} failed to load: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

const catalog_file = (): Promise<CatalogFile> => {
  cached ??= load();
  return cached;
};

export const model_catalog = async (): Promise<ModelCatalog> => (await catalog_file()).catalog;

export const plan_side_config = async (): Promise<PlanSide> => (await catalog_file()).plan_side;
