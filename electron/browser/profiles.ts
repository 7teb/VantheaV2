import { session } from "electron";
import { draft_browser_chat } from "../../shared/ipc/browser.ts";
import { chat_partition, draft_partition } from "./guest-policy.ts";
import { secure_session } from "./guest-security.ts";
import { error_text } from "./state.ts";

const partitions = new Map<string, string>();
const secured = new Set<string>();
const wipes = new Map<string, Promise<void>>();
let drafts = 0;

const fresh_partition = (chat_id: string) => {
  if (chat_id !== draft_browser_chat) {
    return chat_partition(chat_id);
  }
  drafts += 1;
  return draft_partition(drafts);
};

export const acquire_partition = (chat_id: string): string => {
  const known = partitions.get(chat_id);
  if (known) {
    return known;
  }
  const partition = fresh_partition(chat_id);
  if (!secured.has(partition)) {
    secure_session(session.fromPartition(partition));
    secured.add(partition);
  }
  partitions.set(chat_id, partition);
  return partition;
};

export const pending_wipe = (partition: string): Promise<void> | null => wipes.get(partition) ?? null;

export const adopt_partition = (from: string, to: string) => {
  const partition = partitions.get(from);
  if (!partition) {
    return;
  }
  partitions.delete(from);
  if (!partitions.has(to)) {
    partitions.set(to, partition);
  }
};

export const release_partition = (partition: string) => {
  for (const [chat_id, entry] of partitions) {
    if (entry === partition) {
      partitions.delete(chat_id);
    }
  }
  const guest_session = session.fromPartition(partition);
  const wipe = Promise.all([guest_session.clearData(), guest_session.clearAuthCache()]).then(
    () => undefined,
    (error: unknown) => console.warn(`[browser] clearing the browser profile ${partition} failed: ${error_text(error)}`),
  );
  wipes.set(partition, wipe);
  void wipe.then(() => {
    if (wipes.get(partition) === wipe) {
      wipes.delete(partition);
    }
  });
};
