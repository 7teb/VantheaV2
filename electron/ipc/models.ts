import { read_balance } from "../model/balance.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { handle } from "./handle.ts";

export const register_models_ipc = () => {
  handle("models:catalog", () => model_catalog());
  handle("settings:balance", () => read_balance());
};
