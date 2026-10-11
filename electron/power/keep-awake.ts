import { powerSaveBlocker } from "electron";

let blocker_id: number | null = null;

export const keep_awake_active = (): boolean => blocker_id !== null;

export const set_keep_awake = (enabled: boolean): boolean => {
  if (enabled && blocker_id === null) {
    blocker_id = powerSaveBlocker.start("prevent-app-suspension");
    return true;
  }
  if (!enabled && blocker_id !== null) {
    powerSaveBlocker.stop(blocker_id);
    blocker_id = null;
  }
  return blocker_id !== null;
};
