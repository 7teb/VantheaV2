import { model_catalog } from "../model/catalog-file.ts";
import { change_task, create_task, delete_task, set_task_enabled } from "../scheduled/edit.ts";
import { start_task_run } from "../scheduled/run.ts";
import { scheduled_views } from "../scheduled/store.ts";
import { parse_scheduled_input, parse_task_id } from "../scheduled/validate.ts";
import { require_boolean } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

export const register_scheduled_ipc = () => {
  handle("scheduled:list", () => scheduled_views());
  handle("scheduled:save", async (input, id) => {
    const task_id = id === null ? null : parse_task_id(id);
    const parsed = parse_scheduled_input(input, await model_catalog());
    if (task_id === null) {
      await create_task(parsed);
    } else {
      await change_task(task_id, parsed);
    }
    return scheduled_views();
  });
  handle("scheduled:set_enabled", async (id, enabled) => {
    await set_task_enabled(parse_task_id(id), require_boolean(enabled, "task enabled"));
    return scheduled_views();
  });
  handle("scheduled:remove", (id) => {
    delete_task(parse_task_id(id));
    return scheduled_views();
  });
  handle("scheduled:run_now", async (id) => {
    await start_task_run(parse_task_id(id), "manual");
    return scheduled_views();
  });
};
