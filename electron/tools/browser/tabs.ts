import { normalize_browser_target } from "../../browser/guest-policy.ts";
import { navigate, type NavigateAction } from "../../browser/navigate.ts";
import { tab_title, tab_url } from "../../browser/state.ts";
import { close_tab, ensure_active, find_tab, list_tabs, open_tab, run_on_tab } from "../../browser/tabs.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { browser_view, done, guarded, read_choice, read_string } from "./common.ts";

const tab_lines = () => {
  const tabs = list_tabs();
  if (!tabs.length) {
    return 'No browser tabs are open. Use browser_tab with action "new" to open one.';
  }
  return tabs
    .map((tab) => `${tab.active ? "*" : "-"} ${tab.tab_id}${tab.loading ? " (loading)" : ""}${tab.attached ? "" : " (crashed)"}\n  ${tab.url}\n  ${JSON.stringify(tab.title)}`)
    .join("\n");
};

export const browser_tabs_tool = define_tool<Record<string, never>>({
  spec: {
    name: "browser_tabs",
    description: "List the open in-app browser tabs with their tab_id, URL, title and which one is active (marked with *).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan"],
  parse: () => ({}),
  run: async () => {
    const tabs = list_tabs();
    const active = tabs.find((tab) => tab.active);
    return done(tab_lines(), browser_view("tabs", active?.url ?? "", active?.title ?? "", `${tabs.length} open`));
  },
});

type TabArgs = { action: "new"; url: string } | { action: "select" | "close"; tab_id: string | null };

const parse_tab_args = (raw: Record<string, unknown>): TabArgs => {
  const action = read_choice(raw, "action", ["new", "select", "close"] as const, null);
  if (action !== "new") {
    return { action, tab_id: read_string(raw, "tab_id") };
  }
  const target = read_string(raw, "url");
  const url = target === null ? "about:blank" : normalize_browser_target(target);
  if (!url) {
    throw new ToolArgumentError("only http and https URLs can be opened");
  }
  return { action, url };
};

export const browser_tab_tool = define_tool<TabArgs>({
  spec: {
    name: "browser_tab",
    description: "Open a new visible in-app browser tab (optionally at a URL), switch to a tab, or close a tab. Other browser tools act on the active tab unless they take a tab_id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["new", "select", "close"] },
        url: { type: "string", description: "For new: http or https URL, a bare host, or search words." },
        tab_id: { type: "string", description: "For select and close. Defaults to the active tab." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_tab_args,
  run: (ctx, args) =>
    guarded(ctx, `tab ${args.action}`, async () => {
      if (args.action === "new") {
        const tab = await open_tab(args.url, ctx.signal);
        return done(`Opened tab ${tab.tab_id} at ${tab_url(tab)}.`, browser_view("new tab", tab_url(tab), tab_title(tab), tab.tab_id));
      }
      if (args.action === "select") {
        const tab = await ensure_active(args.tab_id, ctx.signal);
        return done(`Tab ${tab.tab_id} is active: ${tab_url(tab)}`, browser_view("select tab", tab_url(tab), tab_title(tab), tab.tab_id));
      }
      const tab = find_tab(args.tab_id);
      if (!tab) {
        throw new Error("Browser tab not found. Call browser_tabs to list the open tabs.");
      }
      const url = tab_url(tab);
      const title = tab_title(tab);
      await close_tab(tab.tab_id, ctx.signal);
      return done(`Closed tab ${tab.tab_id}.\n${tab_lines()}`, browser_view("close tab", url, title, tab.tab_id));
    }),
});

type NavigateArgs = { action: NavigateAction; url: string; tab_id: string | null };

const parse_navigate_args = (raw: Record<string, unknown>): NavigateArgs => {
  const action = read_choice(raw, "action", ["goto", "back", "forward", "reload"] as const, null);
  const tab_id = read_string(raw, "tab_id");
  if (action !== "goto") {
    return { action, url: "", tab_id };
  }
  const url = normalize_browser_target(read_string(raw, "url") ?? "");
  if (!url || url === "about:blank") {
    throw new ToolArgumentError("goto needs an http or https URL");
  }
  return { action, url, tab_id };
};

export const browser_navigate_tool = define_tool<NavigateArgs>({
  spec: {
    name: "browser_navigate",
    description: "Navigate a visible in-app browser tab with goto, back, forward or reload. Only http and https URLs are accepted. goto waits up to 20 seconds for the page to load.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["goto", "back", "forward", "reload"] },
        url: { type: "string", description: "Required for goto." },
        tab_id: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_navigate_args,
  run: (ctx, args) =>
    guarded(ctx, args.action, () =>
      run_on_tab(args.tab_id, ctx.signal, async (tab) => {
        const outcome = await navigate(tab, args.action, args.url, ctx.signal);
        const state = outcome.loading ? " The page is still loading; use browser_wait with condition load before reading it." : "";
        return done(`${args.action} done in tab ${tab.tab_id}: ${outcome.url}.${state}`, browser_view(args.action, outcome.url, tab_title(tab), outcome.loading ? "loading" : "loaded"));
      }),
    ),
});
