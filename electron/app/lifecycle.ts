import { dialog } from "electron";
import { flush_reports, set_report_continuation } from "../agents/reports.ts";
import { clear_chat_agents, init_agents, shutdown_agents_sync } from "../agents/runner.ts";
import { init_background, on_background_finished, remove_chat_background, shutdown_background_sync } from "../background/manager.ts";
import { clear_browser_chat, set_vision_analyzer } from "../browser/vision.ts";
import { init_browser_guest_security } from "../browser/guest-security.ts";
import { flush_all_sync, get_chat, on_chat_removed } from "../chats/store.ts";
import { forget_chat_approvals } from "../ipc/agents.ts";
import { init_extensions } from "../ipc/extensions.ts";
import { kill_all_terminals } from "../ipc/terminal.ts";
import { init_mcp, set_settings_access, shutdown_mcp } from "../mcp/servers.ts";
import { extract_memories_after_turn } from "../memory/extract.ts";
import { memory_prompt_section } from "../memory/prompt.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { set_key_source } from "../model/key.ts";
import { stream_round } from "../model/stream.ts";
import { mcp_command_gate } from "../permissions/mcp-gate.ts";
import { check_project_folders } from "../project/follow.ts";
import { init_snapshots } from "../project/snapshots.ts";
import { set_prompt_sections } from "../prompts/index.ts";
import { get_secret, get_settings, update_settings } from "../settings/store.ts";
import { side_model } from "../side/model.ts";
import { vision_analyzer } from "../side/vision.ts";
import { skills_prompt_section } from "../skills/store.ts";
import { clear_authorization } from "../permissions/context.ts";
import { close_full_window } from "../permissions/full-window.ts";
import { init_persistence } from "../storage/init.ts";
import { flush_pending_sync } from "../storage/json-file.ts";
import { storage_paths } from "../storage/paths.ts";
import { clear_mcp_chat, set_command_gate } from "../tools/mcp/decide.ts";
import { tools_for } from "../tools/registry.ts";
import { interrupt_all_turns, set_turn_finished_hook, stop_turn } from "../turn/run.ts";
import { deliver_pending_events, drop_pending_events, notify_agent_finished, notify_background_finished } from "./notifications.ts";

const run_step = async (step: string, action: () => unknown) => {
  try {
    await action();
  } catch (error) {
    throw new Error(`startup step "${step}" failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

const extract_memories = async (chat_id: string) => {
  const chat = await get_chat(chat_id);
  if (chat) {
    await extract_memories_after_turn(chat, side_model);
  }
};

const wire_hooks = () => {
  set_key_source(() => get_secret("openrouter"));
  set_vision_analyzer(vision_analyzer);
  set_command_gate(mcp_command_gate);
  set_settings_access({ get: get_settings, update: update_settings });
  set_prompt_sections(async ({ project_path, user_text }) => {
    const sections = await Promise.all([memory_prompt_section(project_path, user_text), skills_prompt_section()]);
    return sections.filter((section) => section !== null);
  });
  set_report_continuation(notify_agent_finished);
  set_turn_finished_hook((chat_id) => {
    flush_reports(chat_id);
    deliver_pending_events(chat_id);
    extract_memories(chat_id).catch((error) => console.error(`[memory] extraction for chat ${chat_id} failed:`, error));
  });
  on_background_finished(notify_background_finished);
  on_chat_removed((chat_id) => {
    stop_turn(chat_id);
    clear_chat_agents(chat_id).catch((error) => console.error(`[agents] removing the agents of chat ${chat_id} failed:`, error));
    drop_pending_events(chat_id);
    clear_authorization(chat_id);
    close_full_window(chat_id);
    forget_chat_approvals(chat_id);
    clear_mcp_chat(chat_id);
    clear_browser_chat(chat_id);
    remove_chat_background(chat_id);
  });
};

export const init_services = async (): Promise<void> => {
  wire_hooks();
  await run_step("storage", init_persistence);
  await run_step("snapshots", () => init_snapshots(storage_paths().snapshots));
  await run_step("background tasks", () => init_background());
  await run_step("agents", () =>
    init_agents({
      dir: storage_paths().agents,
      stream: stream_round,
      resolve_tools: (profile, settings) => tools_for(profile, settings),
      side_model,
      models: async () => (await model_catalog()).models,
    }),
  );
  await run_step("memory and skills", init_extensions);
  await run_step("project folders", check_project_folders);
  await run_step("browser guest security", init_browser_guest_security);
  init_mcp().catch((error) => console.error("[mcp] starting configured servers failed:", error));
};

export const shutdown_services = (): void => {
  interrupt_all_turns();
  shutdown_agents_sync();
  kill_all_terminals();
  shutdown_background_sync();
  flush_all_sync();
  flush_pending_sync();
  shutdown_mcp();
};

export const report_startup_failure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[app] startup failed:", error);
  try {
    dialog.showErrorBox("VantheaX failed to start", message);
  } catch (dialog_error) {
    console.error("[app] showing the startup failure dialog failed:", dialog_error);
  }
};
