import { create_store } from "./create-store.ts";

export type TurnFolds = Record<string, Record<string, boolean>>;

export const turn_folds_store = create_store<TurnFolds>({});

export const set_turn_folded = (chat_id: string, message_id: string, folded: boolean) =>
  turn_folds_store.update((state) => ({ ...state, [chat_id]: { ...state[chat_id], [message_id]: folded } }));

export const refold_turns = (chat_id: string, previous_turn: string | null) =>
  turn_folds_store.update((state) => {
    const chosen = state[chat_id] ?? {};
    const ids = previous_turn === null ? Object.keys(chosen) : [...Object.keys(chosen), previous_turn];
    if (ids.every((message_id) => chosen[message_id] === true)) {
      return state;
    }
    return { ...state, [chat_id]: Object.fromEntries(ids.map((message_id) => [message_id, true])) };
  });
