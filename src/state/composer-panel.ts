import { create_store } from "./create-store.ts";

export type ComposerPanel = "memories" | "context";

export const composer_panel_store = create_store<{ key: string; panel: ComposerPanel } | null>(null);

export const open_panel = (key: string, panel: ComposerPanel) => composer_panel_store.set({ key, panel });

export const close_panel = (key: string, panel: ComposerPanel) =>
  composer_panel_store.update((open) => (open?.key === key && open.panel === panel ? null : open));
