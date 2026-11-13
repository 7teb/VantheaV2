import { useLayoutEffect, useState, type RefObject } from "react";
import { fit_phrases, joined_phrases } from "./tool-summary.ts";

let canvas: HTMLCanvasElement | null = null;

const text_width = (font: string, text: string): number => {
  const surface = canvas ?? document.createElement("canvas");
  canvas = surface;
  const context = surface.getContext("2d");
  if (!context) {
    return 0;
  }
  context.font = font;
  return context.measureText(text).width;
};

export const use_fitted_phrases = (ref: RefObject<HTMLElement | null>, phrases: string[], more: string): string => {
  const [fitted, set_fitted] = useState<string | null>(null);
  const key = phrases.join("\n");
  useLayoutEffect(() => {
    const element = ref.current;
    const head = element?.parentElement;
    const group = head?.parentElement;
    if (!element || !head || !group || phrases.length < 2) {
      set_fitted(null);
      return;
    }
    const fit = () => {
      const style = window.getComputedStyle(element);
      const font = ["font-style", "font-weight", "font-size", "font-family"].map((name) => style.getPropertyValue(name)).join(" ");
      const beside = head.offsetWidth - element.offsetWidth;
      set_fitted(fit_phrases(phrases, more, group.clientWidth - beside - 1, (text) => text_width(font, text)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(group);
    return () => observer.disconnect();
  }, [ref, key, more]);
  return fitted ?? joined_phrases(phrases);
};
