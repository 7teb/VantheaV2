import type { RefObject } from "react";
import { layer_count } from "../../components/layers.ts";
import { toggle_plan } from "../../state/composer.ts";
import { cancel_dictation, dictation_store, dictation_supported, start_dictation } from "../../state/dictation.ts";
import { use_shortcut_binding } from "../shell/use-shortcut-binding.ts";

type ComposerShortcuts = { draft_key: string; area: RefObject<HTMLTextAreaElement | null>; finish_dictation: () => void };

const uncovered = () => layer_count() === 0;

const toggle_dictation = (draft_key: string, finish: () => void): boolean => {
  if (!dictation_supported()) {
    return false;
  }
  const state = dictation_store.get();
  if (state === null) {
    if (!uncovered()) {
      return false;
    }
    void start_dictation(draft_key);
    return true;
  }
  if (state.draft_key !== draft_key) {
    return false;
  }
  if (state.phase === "recording") {
    finish();
  } else if (state.phase === "starting") {
    cancel_dictation();
  }
  return true;
};

export const use_composer_shortcuts = ({ draft_key, area, finish_dictation }: ComposerShortcuts) => {
  use_shortcut_binding("dictate", true, () => toggle_dictation(draft_key, finish_dictation));
  use_shortcut_binding("focus_composer", true, () => {
    const node = area.current;
    if (!node || !uncovered()) {
      return false;
    }
    node.focus({ preventScroll: true });
    return true;
  });
  use_shortcut_binding("toggle_plan", true, () => {
    if (!uncovered()) {
      return false;
    }
    toggle_plan(draft_key);
    return true;
  });
};
