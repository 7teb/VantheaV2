import { allowed_keys, allowed_modifiers, click_ref, press_key, scroll_page, type_ref, typed_text, type ScrollRequest, type TypeRequest } from "../../browser/input.ts";
import { snapshot_tab_id } from "../../browser/refs.ts";
import { take_snapshot, type SnapshotOptions } from "../../browser/snapshot.ts";
import { tab_title, tab_url } from "../../browser/state.ts";
import { run_on_tab } from "../../browser/tabs.ts";
import { wait_for, type WaitCondition } from "../../browser/wait.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { browser_view, done, guarded, read_boolean, read_choice, read_number, read_string, require_string } from "./common.ts";

type SnapshotArgs = SnapshotOptions & { tab_id: string | null };

const parse_snapshot_args = (raw: Record<string, unknown>): SnapshotArgs => {
  const scope_ref = read_string(raw, "scope_ref");
  const snapshot_id = read_string(raw, "snapshot_id");
  if (Boolean(scope_ref) !== Boolean(snapshot_id)) {
    throw new ToolArgumentError("scope_ref and snapshot_id must be given together");
  }
  return {
    tab_id: read_string(raw, "tab_id"),
    interactive_only: read_boolean(raw, "interactive_only", false),
    max_chars: read_number(raw, "max_chars"),
    max_nodes: read_number(raw, "max_nodes"),
    scope: scope_ref && snapshot_id ? { snapshot_id, ref: scope_ref } : null,
  };
};

export const browser_snapshot_tool = define_tool<SnapshotArgs>({
  spec: {
    name: "browser_snapshot",
    description:
      "Read the visible browser page as compact untrusted accessibility text, including nested iframes. Returns a snapshot_id and short-lived refs (b1, b2, ...) for browser_click, browser_type and browser_scroll. A snapshot is valid for 30 seconds and for one action; take a new one after every action. Pass snapshot_id with scope_ref to read only the subtree of one ref.",
    parameters: {
      type: "object",
      properties: {
        tab_id: { type: "string" },
        snapshot_id: { type: "string", description: "Only together with scope_ref." },
        scope_ref: { type: "string" },
        interactive_only: { type: "boolean" },
        max_chars: { type: "number" },
        max_nodes: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan"],
  parse: parse_snapshot_args,
  run: (ctx, args) =>
    guarded(ctx, "snapshot", () =>
      run_on_tab(args.tab_id ?? (args.scope ? snapshot_tab_id(args.scope.snapshot_id) : null), ctx.signal, async (tab) => {
        const result = await take_snapshot(tab, args, ctx.signal);
        const header = [`snapshot_id: ${result.snapshot_id}`, `tab_id: ${result.tab_id}`, `loading: ${result.loading}`, `refs: ${result.node_count}${result.truncated ? " (truncated)" : ""}`];
        const detail = `${result.node_count} refs${result.truncated ? ", truncated" : ""}${result.loading ? ", loading" : ""}`;
        return done(`${header.join("\n")}\n${result.content}`, browser_view("snapshot", result.url, result.title, detail));
      }),
    ),
});

type ClickArgs = { snapshot_id: string; ref: string; double: boolean };

export const browser_click_tool = define_tool<ClickArgs>({
  spec: {
    name: "browser_click",
    description: "Click one element from a fresh browser_snapshot by ref, using its live DOM node and real Chromium mouse input. The snapshot is used up afterwards.",
    parameters: {
      type: "object",
      properties: { snapshot_id: { type: "string" }, ref: { type: "string" }, double: { type: "boolean" } },
      required: ["snapshot_id", "ref"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ snapshot_id: require_string(raw, "snapshot_id"), ref: require_string(raw, "ref"), double: read_boolean(raw, "double", false) }),
  run: (ctx, args) =>
    guarded(ctx, "click", () =>
      run_on_tab(null, ctx.signal, async (tab) => {
        const clicked = await click_ref(tab, args.snapshot_id, args.ref, args.double, ctx.signal);
        const verb = args.double ? "Double-clicked" : "Clicked";
        const through = clicked.via_label ? " through its visible label, because the control itself is hidden or covered" : "";
        return done(
          `${verb} ${clicked.ref_name} (${JSON.stringify(clicked.label)})${through} in tab ${tab.tab_id}. Call browser_snapshot before the next action.`,
          browser_view(args.double ? "double click" : "click", tab_url(tab), tab_title(tab), clicked.label),
        );
      }),
    ),
});

export const browser_type_tool = define_tool<TypeRequest>({
  spec: {
    name: "browser_type",
    description:
      "Focus a text field from a fresh browser_snapshot and insert text with real Chromium input. clear (default true) replaces the current value, submit presses Enter afterwards. Text typed into password fields is never echoed back.",
    parameters: {
      type: "object",
      properties: {
        snapshot_id: { type: "string" },
        ref: { type: "string" },
        text: { type: "string" },
        clear: { type: "boolean" },
        submit: { type: "boolean" },
      },
      required: ["snapshot_id", "ref", "text"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => {
    const text = raw.text;
    if (typeof text !== "string") {
      throw new ToolArgumentError("text must be a string");
    }
    return { snapshot_id: require_string(raw, "snapshot_id"), ref: require_string(raw, "ref"), text, clear: read_boolean(raw, "clear", true), submit: read_boolean(raw, "submit", false) };
  },
  run: (ctx, args) =>
    guarded(ctx, "type", () =>
      run_on_tab(null, ctx.signal, async (tab) => {
        const typed = await type_ref(tab, args, ctx.signal);
        const shown = typed_text(args.text, typed.protected);
        const submitted = args.submit ? " and pressed Enter" : "";
        return done(
          `Typed ${shown} into ${typed.ref_name} (${JSON.stringify(typed.label)})${submitted}. Call browser_snapshot before the next action.`,
          browser_view("type", tab_url(tab), tab_title(tab), `${typed.label}: ${shown}${submitted}`),
        );
      }),
    ),
});

type KeyArgs = { key: string; modifiers: string[]; tab_id: string | null };

const parse_key_args = (raw: Record<string, unknown>): KeyArgs => {
  const key = read_choice(raw, "key", [...allowed_keys.keys()], null);
  const modifiers = raw.modifiers ?? [];
  if (!Array.isArray(modifiers) || modifiers.some((value) => typeof value !== "string" || !allowed_modifiers.has(value))) {
    throw new ToolArgumentError(`modifiers must be a list of ${[...allowed_modifiers.keys()].join(", ")}`);
  }
  return { key, modifiers: modifiers as string[], tab_id: read_string(raw, "tab_id") };
};

export const browser_key_tool = define_tool<KeyArgs>({
  spec: {
    name: "browser_key",
    description: "Send one navigation or editing key to the active browser tab. Printable text must use browser_type.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: [...allowed_keys.keys()] },
        modifiers: { type: "array", items: { type: "string", enum: [...allowed_modifiers.keys()] } },
        tab_id: { type: "string" },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_key_args,
  run: (ctx, args) =>
    guarded(ctx, "key", () =>
      run_on_tab(args.tab_id, ctx.signal, async (tab) => {
        await press_key(tab, args.key, args.modifiers, ctx.signal);
        const chord = [...args.modifiers, args.key].join("+");
        return done(`Pressed ${chord} in tab ${tab.tab_id}.`, browser_view("key", tab_url(tab), tab_title(tab), chord));
      }),
    ),
});

type ScrollArgs = ScrollRequest & { tab_id: string | null };

const parse_scroll_args = (raw: Record<string, unknown>): ScrollArgs => {
  const snapshot_id = read_string(raw, "snapshot_id");
  const ref = read_string(raw, "ref");
  if (Boolean(snapshot_id) !== Boolean(ref)) {
    throw new ToolArgumentError("snapshot_id and ref must be given together");
  }
  return {
    direction: read_choice(raw, "direction", ["up", "down", "start", "end"] as const, null),
    amount: read_choice(raw, "amount", ["small", "page"] as const, "small"),
    target: snapshot_id && ref ? { snapshot_id, ref } : null,
    tab_id: read_string(raw, "tab_id"),
  };
};

export const browser_scroll_tool = define_tool<ScrollArgs>({
  spec: {
    name: "browser_scroll",
    description: "Scroll the page, or the scrollable container of a fresh snapshot ref when snapshot_id and ref are given.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "start", "end"] },
        amount: { type: "string", enum: ["small", "page"] },
        snapshot_id: { type: "string" },
        ref: { type: "string" },
        tab_id: { type: "string" },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_scroll_args,
  run: (ctx, args) =>
    guarded(ctx, "scroll", () =>
      run_on_tab(args.target ? null : args.tab_id, ctx.signal, async (tab) => {
        await scroll_page(tab, args, ctx.signal);
        const detail = `${args.direction}${args.direction === "up" || args.direction === "down" ? `, ${args.amount}` : ""}`;
        return done(`Scrolled ${detail} in tab ${tab.tab_id}.`, browser_view("scroll", tab_url(tab), tab_title(tab), detail));
      }),
    ),
});

type WaitArgs = { condition: WaitCondition; value: string; timeout_ms: number | null; tab_id: string | null };

const parse_wait_args = (raw: Record<string, unknown>): WaitArgs => {
  const condition = read_choice(raw, "condition", ["load", "url_contains", "text", "element"] as const, null);
  const value = read_string(raw, "value") ?? "";
  if (condition !== "load" && !value) {
    throw new ToolArgumentError(`condition ${condition} needs a value`);
  }
  return { condition, value, timeout_ms: read_number(raw, "timeout_ms"), tab_id: read_string(raw, "tab_id") };
};

export const browser_wait_tool = define_tool<WaitArgs>({
  spec: {
    name: "browser_wait",
    description: "Wait until the page finished loading, the URL contains a substring, visible text appears, or an element with an accessible name appears. timeout_ms defaults to 10000, at most 120000.",
    parameters: {
      type: "object",
      properties: {
        condition: { type: "string", enum: ["load", "url_contains", "text", "element"] },
        value: { type: "string" },
        timeout_ms: { type: "number" },
        tab_id: { type: "string" },
      },
      required: ["condition"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_wait_args,
  run: (ctx, args) =>
    guarded(ctx, "wait", () =>
      run_on_tab(args.tab_id, ctx.signal, async (tab) => {
        const elapsed = await wait_for(tab, args.condition, args.value, args.timeout_ms, ctx.signal);
        const detail = args.condition === "load" ? "load" : `${args.condition} ${JSON.stringify(args.value)}`;
        return done(`Matched ${detail} after ${elapsed} ms in tab ${tab.tab_id}.`, browser_view("wait", tab_url(tab), tab_title(tab), detail));
      }),
    ),
});
