import { readFile } from "node:fs/promises";
import path from "node:path";

const read_json = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

export const read_catalog_source = async (dir: string): Promise<Record<string, unknown>> => {
  const index_file = path.join(dir, "index.json");
  const index = await read_json(index_file);
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    throw new Error(`${index_file}: must be an object`);
  }
  const { model_files, ...rest } = index as Record<string, unknown>;
  if (!Array.isArray(model_files) || !model_files.every((name) => typeof name === "string")) {
    throw new Error(`${index_file}: model_files must be an array of file names`);
  }
  const lists = await Promise.all(
    model_files.map(async (name: string) => {
      const file = path.join(dir, name);
      const models = await read_json(file);
      if (!Array.isArray(models)) {
        throw new Error(`${file}: must be an array of models`);
      }
      return models;
    }),
  );
  return { ...rest, models: lists.flat() };
};
