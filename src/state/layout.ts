import { create_store } from "./create-store.ts";

export const layout_queries = {
  phone: "(max-width: 600px)",
  drawer: "(max-width: 860px)",
  short: "(max-height: 500px)",
  touch: "(hover: none) and (pointer: coarse)",
  fine_pointer: "(any-pointer: fine)",
} as const;

export type Layout = Record<keyof typeof layout_queries, boolean>;

const media = {
  phone: window.matchMedia(layout_queries.phone),
  drawer: window.matchMedia(layout_queries.drawer),
  short: window.matchMedia(layout_queries.short),
  touch: window.matchMedia(layout_queries.touch),
  fine_pointer: window.matchMedia(layout_queries.fine_pointer),
};

const read_layout = (): Layout => ({
  phone: media.phone.matches,
  drawer: media.drawer.matches,
  short: media.short.matches,
  touch: media.touch.matches,
  fine_pointer: media.fine_pointer.matches,
});

export const layout_store = create_store<Layout>(read_layout());

for (const list of Object.values(media)) {
  list.addEventListener("change", () => layout_store.set(read_layout()));
}
