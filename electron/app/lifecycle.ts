import { dialog } from "electron";
import { flush_reports, set_agent_continuation } from "../agents/reports.ts";
import { clear_chat_agents, init_agents, running_agent_roots, shutdown_agents_sync } from "../agents/runner.ts";
import { on_agents_changed } from "../agents/store.ts";
import { init_background, on_background_changed, on_background_finished, remove_chat_background, running_background_roots, shutdown_background_sync } from "../background/manager.ts";
import { set_vision_analyzer } from "../browser/vision.ts";
import { init_browser, shutdown_browser } from "../browser/service.ts";
import { close_chat_tabs } from "../browser/tabs.ts";
import { chat_file } from "../chats/files.ts";
import { chat_meta, flush_all_sync, get_chat, on_chat_removed } from "../chats/store.ts";
import { chat_home_of, chat_root } from "../chats/workspace.ts";
import { git_service, init_git, shutdown_git } from "../git/index.ts";
import { entry_kind } from "../git/repo.ts";
import { init_github, shutdown_github } from "../github/index.ts";
import { forget_chat_approvals } from "../ipc/agents.ts";
import { init_extensions } from "../ipc/extensions.ts";
import { stop_chat_files_watch, stop_files_watch } from "../ipc/files.ts";
import { close_chat_terminals, kill_all_terminals } from "../ipc/terminal.ts";
import { init_mcp, set_settings_access, shutdown_mcp } from "../mcp/servers.ts";
import { sweep_attachments } from "../media/sweep.ts";
import { extract_memories_after_turn } from "../memory/extract.ts";
import { memory_prompt_section } from "../memory/prompt.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { set_key_source } from "../model/key.ts";
import { stream_round } from "../model/stream.ts";
import { mcp_command_gate } from "../permissions/mcp-gate.ts";
import { check_project_folders } from "../project/follow.ts";
import { forget_chat_reads } from "../project/read-ledger.ts";
import { set_prompt_sections } from "../prompts/index.ts";
import { shutdown_remote } from "../remote/server.ts";
import { forget_answers, settle_answers } from "../questions/answers.ts";
import { get_secret, get_settings, update_settings } from "../settings/store.ts";
import { side_model } from "../side/model.ts";
import { context_model } from "../settings/model-context.ts";
import { reasoning_status_call } from "../side/reasoning-status.ts";
import { review_call } from "../side/review.ts";
import { vision_analyzer } from "../side/vision.ts";
import { skills_prompt_section } from "../skills/store.ts";
import { clear_authorization } from "../permissions/context.ts";
import { close_full_window } from "../permissions/full-window.ts";
import { forget_instruction_files } from "../permissions/instruction-files.ts";
import { clear_review_chat } from "../permissions/review-state.ts";
import { forget_chat_writes } from "../permissions/written-files.ts";
import { set_keep_awake } from "../power/keep-awake.ts";
import { init_git_bash } from "../shell/git-bash.ts";
import { system_probe } from "../shell/git-bash-probe.ts";
import { init_persistence } from "../storage/init.ts";
import { flush_pending_sync } from "../storage/json-file.ts";
import { remove_retired_snapshots, storage_paths } from "../storage/paths.ts";
import { clear_mcp_chat, set_command_gate } from "../tools/mcp/decide.ts";
import { tools_for } from "../tools/registry.ts";
import { active_turn, active_turns, forget_user_stop, on_active_turns_changed, turn_settled } from "../turn/active.ts";
import { init_turn_diffs, turn_diffs } from "../turn-diff/index.ts";
import { set_turn_finished_hook } from "../turn/drive.ts";
import { interrupt_all_turns, stop_turn } from "../turn/run.ts";
import { release_worktree } from "../worktrees/remove.ts";
import { sweep_worktree_ledger } from "../worktrees/sweep.ts";
import { saved_workflows_section } from "../workflows/prompt.ts";
import { clear_chat_workflows, init_workflows, shutdown_workflows_sync } from "../workflows/runtime.ts";
import { record_swept_worktrees } from "../workflows/store.ts";
import { deliver_pending_events, drop_pending_events, notify_agent, notify_background_finished } from "./notifications.ts";

let shutting_down = false;

const run_step = async (step: string, action: () => unknown) => {
  try {
    await action();
  } catch (error) {
    throw new Error(`startup step "${step}" failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

const extract_memories = async (chat_id: string, message_id: string) => {
  const chat = await get_chat(chat_id);
  if (chat) {
    await extract_memories_after_turn(chat, message_id, side_model);
  }
};

const turn_root = async (chat_id: string): Promise<string | null> => {
  const chat = chat_meta(chat_id);
  if (!chat) return null;
  try {
    return await chat_root(chat);
  } catch (error) {
    console.error(`[git] resolving the folder of chat ${chat_id} with a running turn failed:`, error);
    return null;
  }
};

const chat_known = async (chat_id: string): Promise<boolean> => chat_meta(chat_id) !== null || (await entry_kind(chat_file(chat_id))) !== null;

const wire_hooks = () => {
  set_key_source(() => get_secret("openrouter"));
  set_vision_analyzer(vision_analyzer);
  set_command_gate(mcp_command_gate);
  set_settings_access({ get: get_settings, update: update_settings });
  set_prompt_sections(async ({ chat_id, user_text, tool_names }) => {
    const sections = await Promise.all([memory_prompt_section(await chat_home_of(chat_id), user_text, tool_names), skills_prompt_section(), saved_workflows_section(chat_id, tool_names)]);
    return sections.filter((section) => section !== null);
  });
  set_agent_continuation(notify_agent);
  set_turn_finished_hook((chat_id, message_id) => {
    if (shutting_down) {
      return;
    }
    settle_answers(chat_id, message_id).catch((error) => console.error(`[questions] settling the answers of chat ${chat_id} failed:`, error));
    flush_reports(chat_id);
    deliver_pending_events(chat_id);
    extract_memories(chat_id, message_id).catch((error) => console.error(`[memory] extraction for message ${message_id} in chat ${chat_id} failed:`, error));
  });
  on_background_finished((task) => {
    if (task.ended_at) turn_diffs.work_ended(task.chat_id, task.id, task.started_at, task.ended_at);
  });
  on_background_finished(notify_background_finished);
  on_active_turns_changed(() => git_service.work_changed());
  on_background_changed(() => git_service.work_changed());
  on_agents_changed(() => git_service.work_changed());
  on_agents_changed((summary) => {
    for (const run of summary.runs) {
      if (run.ended_at && run.status !== "interrupted") turn_diffs.work_ended(summary.chat_id, run.run_id, run.started_at, run.ended_at);
    }
  });
  on_chat_removed((chat_id, meta) => {
    const workflows_cleared = clear_chat_workflows(chat_id);
    workflows_cleared.catch((error) => console.error(`[workflows] removing the workflows of chat ${chat_id} failed:`, error));
    stop_turn(chat_id);
    const agents_cleared = clear_chat_agents(chat_id);
    agents_cleared.then(() => git_service.work_changed()).catch((error) => console.error(`[agents] removing the agents of chat ${chat_id} failed:`, error));
    forget_user_stop(chat_id);
    drop_pending_events(chat_id);
    clear_authorization(chat_id);
    forget_instruction_files(chat_id);
    clear_review_chat(chat_id);
    forget_chat_writes(chat_id);
    forget_chat_reads(chat_id).catch((error) => console.error(`[reads] removing the read ledger of the deleted chat ${chat_id} failed:`, error));
    close_full_window(chat_id);
    forget_chat_approvals(chat_id);
    clear_mcp_chat(chat_id);
    remove_chat_background(chat_id);
    forget_answers(chat_id);
    close_chat_tabs(chat_id);
    close_chat_terminals(chat_id);
    stop_chat_files_watch(chat_id);
    turn_diffs.remove_chat(chat_id).catch((error) => console.error(`[turn-diff] removing the turn snapshots of the deleted chat ${chat_id} failed:`, error));
    const { worktree } = meta;
    if (worktree) {
      release_worktree({ chat_id, project_path: meta.project_path, worktree, settled: Promise.all([turn_settled(chat_id), agents_cleared, workflows_cleared]) }).catch((error) =>
        console.error(`[worktrees] removing the worktree ${worktree.path} of the deleted chat ${chat_id} failed, it is retried at the next start:`, error),
      );
    }
  });
};

export const init_services = async (): Promise<void> => {
  wire_hooks();
  await run_step("storage", init_persistence);
  const swept = sweep_worktree_ledger().catch((error: unknown) => {
    console.error("[worktrees] finishing worktree steps left over from the last run failed:", error);
    return [];
  });
  sweep_attachments().catch((error) => console.error("[media] attachment sweep failed:", error));
  remove_retired_snapshots(storage_paths()).catch((error) => console.error("[storage] removing the retired undo snapshot folder failed:", error));
  await run_step("git bash", () => init_git_bash(system_probe));
  await run_step("git", () =>
    init_git({ turn_chats: () => active_turns().map(([chat_id]) => chat_id), chat_root: turn_root, agent_roots: running_agent_roots, background_roots: running_background_roots }),
  );
  await run_step("github", init_github);
  await run_step("background tasks", () => init_background());
  await run_step("turn diffs", () =>
    init_turn_diffs({
      root: storage_paths().turn_diffs,
      messages: async (chat_id) => (await get_chat(chat_id))?.messages ?? null,
      chat_root: async (chat_id) => {
        const chat = chat_meta(chat_id);
        if (!chat) throw new Error(`chat ${chat_id} is not in the chat index`);
        return chat_root(chat);
      },
      running_turn: (chat_id) => active_turn(chat_id)?.message_id ?? null,
      chat_known,
    }),
  );
  await run_step("agents", () =>
    init_agents({
      dir: storage_paths().agents,
      stream: stream_round,
      resolve_tools: (profile, settings, model) => tools_for(profile, settings, model),
      side_model,
      review_call,
      models: async () => (await model_catalog()).models.map(context_model),
      reasoning_status: reasoning_status_call,
    }),
  );
  await run_step("workflows", () => init_workflows(storage_paths().workflows));
  swept.then(record_swept_worktrees).catch((error: unknown) => console.error("[workflows] recording the agent worktrees the startup sweep settled failed:", error));
  await run_step("memory and skills", init_extensions);
  await run_step("project folders", check_project_folders);
  await run_step("browser", init_browser);
  init_mcp().catch((error) => console.error("[mcp] starting configured servers failed:", error));
};

export const shutdown_services = (): void => {
  shutting_down = true;
  shutdown_remote();
  interrupt_all_turns();
  turn_diffs.shutdown();
  shutdown_workflows_sync();
  shutdown_agents_sync();
  kill_all_terminals();
  shutdown_browser();
  stop_files_watch();
  shutdown_github();
  shutdown_git();
  shutdown_background_sync();
  flush_all_sync();
  flush_pending_sync();
  shutdown_mcp();
  set_keep_awake(false);
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
