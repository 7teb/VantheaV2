type ChatQueue = { controller: AbortController; chain: Promise<void> };

const queues = new Map<string, ChatQueue>();

const queue_of = (chat_id: string): ChatQueue => {
  const existing = queues.get(chat_id);
  if (existing) return existing;
  const created: ChatQueue = { controller: new AbortController(), chain: Promise.resolve() };
  queues.set(chat_id, created);
  return created;
};

export const run = <T>(chat_id: string, name: string, job: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const queue = queue_of(chat_id);
  const { signal } = queue.controller;
  const result = queue.chain.then(() => job(signal));
  queue.chain = result.then(
    () => undefined,
    (error: unknown) => {
      if (signal.aborted) {
        console.info(`[turn-diff] job "${name}" of chat ${chat_id} stopped: ${String(signal.reason)}`);
        return;
      }
      console.error(`[turn-diff] job "${name}" of chat ${chat_id} failed:`, error);
    },
  );
  return result;
};

export const tail = (chat_id: string): Promise<void> => queues.get(chat_id)?.chain ?? Promise.resolve();

export const stop_chat = async (chat_id: string, reason: string): Promise<void> => {
  const queue = queues.get(chat_id);
  if (!queue) return;
  queue.controller.abort(new Error(reason));
  await queue.chain;
  if (queues.get(chat_id) === queue) queues.delete(chat_id);
};

export const stop_all = (reason: string): void => {
  for (const queue of queues.values()) queue.controller.abort(new Error(reason));
  queues.clear();
};
