import { createHash } from "node:crypto";
import type { HumanRequest } from "./context.ts";
import type { ProjectProfile } from "./project-profile.ts";
import { estimate_review_tokens, max_later_blocks, section_caps, trimmed, type TrimLevel } from "./review-budget.ts";
import { feed_text, type ActionLine, type FeedLine } from "./review-lines.ts";
import { agent_part, chat_part, decision_lines, fit_actions, later_block, script_lines, type AgentView, type ChatView } from "./review-sections.ts";
import { retained_line, type RetainedScript } from "./script-retention.ts";

export type ReviewPart = { text: string; marker: boolean };

type ChatState = { key: string; tag: string; text: string; profile: ProjectProfile; generation: number };

type InstanceState = {
  generation: number;
  level: TrimLevel;
  task: string;
  chat_text: string;
  agent_text: string;
  decisions: Map<string, string>;
  actions: Map<string, string>;
  scripts: Map<string, string>;
  blocks: string[];
};

export type StateInput = {
  chat: ChatView;
  chat_key: string;
  agent: AgentView;
  feed: FeedLine[];
  actions: ActionLine[];
  retained: RetainedScript[];
};

const chats = new Map<string, ChatState>();

const instances = new Map<string, InstanceState>();

const offline = new Map<string, number>();

let generations = 0;

export const instance_key = (chat_id: string, actor_id: string): string => `${chat_id}:${actor_id}`;

export const chat_fold_key = (humans: HumanRequest[], custom_instructions: string): string =>
  createHash("sha256")
    .update(JSON.stringify([custom_instructions, humans.map((entry) => [entry.id, entry.text, entry.assistant_reference?.text ?? ""])]))
    .digest("hex");

export const stored_profile = (chat_id: string, key: string): ProjectProfile | null => {
  const state = chats.get(chat_id);
  return state?.key === key ? state.profile : null;
};

export const offline_until = (key: string): number | null => {
  const until = offline.get(key) ?? 0;
  return until > Date.now() ? until : null;
};

export const open_offline = (key: string, until: number): void => {
  offline.set(key, until);
};

export const close_offline = (key: string): void => {
  offline.delete(key);
};

export const clear_review_chat = (chat_id: string): void => {
  chats.delete(chat_id);
  for (const map of [instances, offline]) {
    for (const key of [...map.keys()]) {
      if (key.startsWith(`${chat_id}:`)) map.delete(key);
    }
  }
};

export const clear_review_instance = (chat_id: string, actor_id: string): void => {
  instances.delete(instance_key(chat_id, actor_id));
  offline.delete(instance_key(chat_id, actor_id));
};

const chat_state = (input: StateInput, new_tag: () => string): ChatState => {
  const existing = chats.get(input.chat.chat_id);
  if (existing?.key === input.chat_key) {
    return existing;
  }
  const tag = new_tag();
  generations += 1;
  const state: ChatState = { key: input.chat_key, tag, text: chat_part(input.chat, tag, 0), profile: input.chat.profile, generation: generations };
  chats.set(input.chat.chat_id, state);
  return state;
};

const with_markers = (state: InstanceState): ReviewPart[] => [
  { text: state.chat_text, marker: true },
  { text: state.agent_text, marker: true },
  ...state.blocks.map((text, index) => ({ text, marker: index >= state.blocks.length - 2 })),
];

const fresh_lines = (now: Map<string, string>, shown: Map<string, string>): string[] => [...now].filter(([key, text]) => shown.get(key) !== text).map(([, text]) => text);

export const review_parts = (input: StateInput, level: TrimLevel, new_tag: () => string): { parts: ReviewPart[]; tag: string } => {
  const chat = chat_state(input, new_tag);
  const key = instance_key(input.chat.chat_id, input.agent.actor.id);
  const previous = instances.get(key);
  const task = input.agent.delegated_task ?? "";
  const decisions = new Map(input.feed.map((line) => [line.key, feed_text(line)]));
  const actions = new Map(input.actions.map((line) => [line.key, line.text]));
  const scripts = new Map(input.retained.map((entry) => [entry.key, retained_line(entry)]));
  const status_changed = previous ? [...previous.decisions].some(([id, text]) => decisions.get(id) !== text) : true;
  if (previous && level === 0 && previous.level === 0 && previous.generation === chat.generation && previous.task === task && !status_changed) {
    const block = later_block({
      decisions: fresh_lines(decisions, previous.decisions),
      actions: fresh_lines(actions, previous.actions),
      scripts: fresh_lines(scripts, previous.scripts),
    });
    const blocks = block ? [...previous.blocks, block] : previous.blocks;
    if (blocks.length <= max_later_blocks && estimate_review_tokens(blocks.join("")) <= section_caps.later_blocks) {
      const next = { ...previous, decisions, actions, scripts, blocks };
      instances.set(key, next);
      return { parts: with_markers(next), tag: chat.tag };
    }
  }
  const chat_text = trimmed(level, "project") || trimmed(level, "assistant_before") ? chat_part(input.chat, chat.tag, level) : chat.text;
  const agent_text = agent_part(
    input.agent,
    {
      decisions: decision_lines(input.feed, level),
      actions: fit_actions(input.actions, level, input.agent.earlier_commands),
      scripts: script_lines(input.retained, level),
    },
    chat.tag,
    level,
  );
  const state: InstanceState = { generation: chat.generation, level, task, chat_text, agent_text, decisions, actions, scripts, blocks: [] };
  instances.set(key, state);
  return { parts: with_markers(state), tag: chat.tag };
};
