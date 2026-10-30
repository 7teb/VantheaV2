import { useEffect } from "react";

const keyboard_threshold_px = 150;

const editing = () => {
  const node = document.activeElement;
  return node instanceof HTMLElement && (node.matches("input, textarea") || node.isContentEditable);
};

export const use_visual_viewport = () => {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const root = document.documentElement;
    let full = { width: viewport.width, height: viewport.height };
    const sync = () => {
      if (viewport.scale > 1) {
        return;
      }
      if (viewport.width !== full.width || viewport.height > full.height) {
        full = { width: viewport.width, height: viewport.height };
      }
      root.style.setProperty("--viewport-height", `${viewport.height}px`);
      root.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
      const shrunk = full.height - viewport.height > keyboard_threshold_px;
      root.dataset.keyboard = shrunk && (editing() || root.dataset.keyboard === "open") ? "open" : "closed";
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      root.style.removeProperty("--viewport-height");
      root.style.removeProperty("--viewport-top");
      delete root.dataset.keyboard;
    };
  }, []);
};
