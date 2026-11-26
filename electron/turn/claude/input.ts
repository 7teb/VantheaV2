import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ApiMessage } from "../../model/types.ts";
import { deliver_input, inject_steers } from "../loop.ts";
import type { TurnSession } from "../session.ts";
import { message_blocks, type UserBlock } from "./content.ts";
import type { Rounds } from "./rounds.ts";

export type InputChannel = {
  prompt: AsyncIterable<SDKUserMessage>;
  send: (blocks: UserBlock[], first: boolean) => void;
  command: (text: string) => void;
  acknowledge: (uuids: readonly string[]) => void;
  pending: () => boolean;
  end: () => void;
};

export type Feeder = {
  push: (messages: ApiMessage[]) => void;
  poll: (round: number) => Promise<boolean>;
  steers: (round: number) => Promise<boolean>;
  serial: <T>(work: () => Promise<T>) => Promise<T>;
};

export const create_input_channel = (): InputChannel => {
  const buffer: SDKUserMessage[] = [];
  const pending = new Set<string>();
  let waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  let ended = false;

  const deliver = (message: SDKUserMessage) => {
    if (ended) {
      return;
    }
    const resolve = waiting;
    if (resolve) {
      waiting = null;
      resolve({ done: false, value: message });
      return;
    }
    buffer.push(message);
  };

  const end = () => {
    ended = true;
    const resolve = waiting;
    waiting = null;
    resolve?.({ done: true, value: undefined });
  };

  const iterator: AsyncIterator<SDKUserMessage> = {
    next: () => {
      const message = buffer.shift();
      if (message) {
        return Promise.resolve({ done: false, value: message });
      }
      if (ended) {
        return Promise.resolve({ done: true, value: undefined });
      }
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    return: () => {
      end();
      return Promise.resolve({ done: true, value: undefined });
    },
  };

  return {
    prompt: { [Symbol.asyncIterator]: () => iterator },
    send: (blocks, first) => {
      const uuid = randomUUID();
      if (!first) {
        pending.add(uuid);
      }
      deliver({
        type: "user",
        message: { role: "user", content: blocks },
        parent_tool_use_id: null,
        uuid,
        client_composed: true,
        ...(first ? {} : { priority: "next" as const }),
      });
    },
    command: (text) => deliver({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid: randomUUID() }),
    acknowledge: (uuids) => {
      for (const uuid of uuids) {
        pending.delete(uuid);
      }
    },
    pending: () => pending.size > 0,
    end,
  };
};

export const create_feeder = (session: TurnSession, channel: InputChannel, rounds: Rounds, closing: () => boolean): Feeder => {
  const tasks: (() => Promise<void>)[] = [];
  let draining = false;

  const drain = async () => {
    draining = true;
    for (let task = tasks.shift(); task; task = tasks.shift()) {
      await task();
    }
    draining = false;
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      tasks.push(() => work().then(resolve, reject));
      if (!draining) {
        void drain();
      }
    });

  const push = (messages: ApiMessage[]) => {
    if (!messages.length) {
      return;
    }
    channel.send(messages.flatMap(message_blocks), false);
    rounds.hold(messages);
  };

  const feed = (collect: (scratch: ApiMessage[]) => Promise<unknown>) =>
    serial(async () => {
      if (closing()) {
        return false;
      }
      const scratch: ApiMessage[] = [];
      await collect(scratch);
      push(scratch);
      return scratch.length > 0;
    });

  return {
    push,
    poll: (round) => feed((scratch) => deliver_input(session, round, scratch)),
    steers: (round) => feed((scratch) => inject_steers(session, round, scratch)),
    serial,
  };
};
