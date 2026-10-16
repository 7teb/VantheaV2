import { app_channels } from "./app.ts";
import { browser_channels } from "./browser.ts";
import type { Emit, Invoke, Send } from "./channel.ts";
import { chats_channels } from "./chats.ts";
import { extensions_channels } from "./extensions.ts";
import { files_channels } from "./files.ts";
import { git_channels } from "./git.ts";
import { github_channels } from "./github.ts";
import { media_channels } from "./media.ts";
import { panels_channels } from "./panels.ts";
import { questions_channels } from "./questions.ts";
import { settings_channels } from "./settings.ts";
import { work_channels } from "./work.ts";

export const channels = {
  ...app_channels,
  ...settings_channels,
  ...chats_channels,
  ...media_channels,
  ...work_channels,
  ...extensions_channels,
  ...panels_channels,
  ...browser_channels,
  ...questions_channels,
  ...files_channels,
  ...git_channels,
  ...github_channels,
} as const;

export type Channels = typeof channels;

type NamesOf<Kind> = { [K in keyof Channels]: Channels[K] extends Kind ? K : never }[keyof Channels];

export type InvokeName = NamesOf<Invoke<unknown[], unknown>>;

export type SendName = NamesOf<Send<unknown[]>>;

export type EventName = NamesOf<Emit<unknown>>;

export type InvokeArgs<K extends InvokeName> = Channels[K] extends Invoke<infer A, unknown> ? A : never;

export type InvokeResult<K extends InvokeName> = Channels[K] extends Invoke<unknown[], infer R> ? R : never;

export type SendArgs<K extends SendName> = Channels[K] extends Send<infer A> ? A : never;

export type EventPayload<K extends EventName> = Channels[K] extends Emit<infer P> ? P : never;

export type Bridge = {
  invoke: <K extends InvokeName>(name: K, ...args: InvokeArgs<K>) => Promise<InvokeResult<K>>;
  send: <K extends SendName>(name: K, ...args: SendArgs<K>) => void;
  on: <K extends EventName>(name: K, listener: (payload: EventPayload<K>) => void) => () => void;
  file_path: (file: File) => string;
};

export const channel_kind = (name: string): "invoke" | "send" | "event" | null =>
  Object.hasOwn(channels, name) ? channels[name as keyof Channels].kind : null;
