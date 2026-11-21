import { billing_catalog } from "../billing/catalog.ts";
import { read_balance } from "../model/balance.ts";
import { handle } from "./handle.ts";

export const register_models_ipc = () => {
  handle("models:catalog", () => billing_catalog());
  handle("settings:balance", () => read_balance());
};
