import { useEffect } from "react";
import { editable_selector, is_select_all, select_all_region } from "./select-all.ts";

const focused_element = (target: EventTarget | null): Element | null =>
  target instanceof Element && target !== document.body && target !== document.documentElement ? target : null;

export const use_select_all = () => {
  useEffect(() => {
    let pointer: Element | null = null;
    const on_pointer_down = (event: PointerEvent) => {
      pointer = event.target instanceof Element ? event.target : null;
    };
    const on_key_down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !is_select_all(event)) {
        return;
      }
      const focused = focused_element(event.target);
      if (focused?.closest(editable_selector)) {
        return;
      }
      event.preventDefault();
      const region = select_all_region(focused, pointer);
      if (region) {
        window.getSelection()?.selectAllChildren(region);
      }
    };
    window.addEventListener("pointerdown", on_pointer_down, true);
    window.addEventListener("keydown", on_key_down);
    return () => {
      window.removeEventListener("pointerdown", on_pointer_down, true);
      window.removeEventListener("keydown", on_key_down);
    };
  }, []);
};
