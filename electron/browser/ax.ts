import type { AxEntry, CheckState } from "./state.ts";

type AxValue = { value?: unknown };

export type AxNode = {
  nodeId?: string;
  backendDOMNodeId?: number;
  frameId?: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  description?: AxValue;
  value?: AxValue;
  properties?: { name?: string; value?: AxValue }[];
  childIds?: string[];
};

const interactive_roles = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const content_roles = new Set([
  "article",
  "caption",
  "cell",
  "columnheader",
  "definition",
  "dialog",
  "document",
  "heading",
  "img",
  "list",
  "listitem",
  "main",
  "paragraph",
  "region",
  "row",
  "rowheader",
  "statictext",
  "table",
  "term",
]);

export const text_input_roles = new Set(["textbox", "searchbox"]);

const plain = (value: AxValue | undefined) => String(value?.value ?? "").replace(/\s+/g, " ").trim();

const check_state = (value: unknown): CheckState => (value === "mixed" ? "mixed" : value === true || value === "true" || value === 1);

const optional_state = (properties: Map<string, unknown>, key: string): CheckState | null =>
  properties.has(key) ? check_state(properties.get(key)) : null;

export const read_ax_node = (node: AxNode): AxEntry => {
  const properties = new Map<string, unknown>((node.properties ?? []).map((entry) => [String(entry.name ?? ""), entry.value?.value]));
  const autocomplete = properties.get("autocomplete");
  const protected_field = Boolean(properties.get("protected")) || autocomplete === "current-password" || autocomplete === "new-password";
  return {
    ax_node_id: String(node.nodeId ?? ""),
    backend_node_id: Number(node.backendDOMNodeId) || 0,
    frame_id: String(node.frameId ?? ""),
    ignored: Boolean(node.ignored),
    role: String(node.role?.value ?? "").toLowerCase(),
    name: plain(node.name),
    description: plain(node.description),
    value: protected_field ? "" : plain(node.value),
    protected: protected_field,
    disabled: Boolean(properties.get("disabled")),
    checked: optional_state(properties, "checked"),
    selected: optional_state(properties, "selected"),
    expanded: optional_state(properties, "expanded"),
    focused: Boolean(properties.get("focused")),
    level: Number(properties.get("level")) || 0,
  };
};

export const should_include = (entry: AxEntry, interactive_only: boolean) => {
  if (entry.ignored || !entry.role) {
    return false;
  }
  if (interactive_roles.has(entry.role)) {
    return Boolean(entry.name || entry.value || text_input_roles.has(entry.role));
  }
  if (interactive_only || !content_roles.has(entry.role)) {
    return false;
  }
  return Boolean(entry.name || entry.value || entry.description);
};

const state_words = (entry: AxEntry) => {
  const states: string[] = [];
  if (entry.protected) {
    states.push("protected");
  }
  if (entry.disabled) {
    states.push("disabled");
  }
  if (entry.checked !== null) {
    states.push(entry.checked === "mixed" ? "mixed" : entry.checked ? "checked" : "unchecked");
  }
  if (entry.selected !== null) {
    states.push(entry.selected ? "selected" : "unselected");
  }
  if (entry.expanded !== null) {
    states.push(entry.expanded ? "expanded" : "collapsed");
  }
  if (entry.level) {
    states.push(`level=${entry.level}`);
  }
  return states;
};

export const format_entry = (entry: AxEntry, ref: string) => {
  const text = entry.name || entry.value || entry.description;
  const quoted = text ? ` ${JSON.stringify(text.slice(0, 800))}` : "";
  const states = state_words(entry);
  return `[${ref}] ${entry.role}${quoted}${states.length ? ` ${states.join(" ")}` : ""}`;
};

export const is_mask_glyphs = (entry: AxEntry) => entry.role === "statictext" && /^[•●*]+$/.test(entry.name);

export const normalize_ref = (value: string) => {
  const raw = value.trim();
  const candidate = raw.match(/^\[([^\]]+)\]$/)?.[1] ?? raw;
  const match = candidate.match(/^b(\d+)$/i) ?? candidate.match(/^ref[_-]?(\d+)$/i);
  if (!match) {
    return candidate;
  }
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0 ? `b${index}` : candidate;
};

export const descendants = (root_id: string, nodes_by_id: Map<string, AxNode>, into: Set<string>) => {
  const pending = [root_id];
  while (pending.length) {
    const node_id = pending.pop();
    if (!node_id || into.has(node_id)) {
      continue;
    }
    into.add(node_id);
    for (const child_id of nodes_by_id.get(node_id)?.childIds ?? []) {
      pending.push(String(child_id));
    }
  }
  return into;
};

export const is_protected_attributes = (attributes: string[]) => {
  for (let index = 0; index < attributes.length; index += 2) {
    const key = String(attributes[index] ?? "").toLowerCase();
    const value = String(attributes[index + 1] ?? "").toLowerCase();
    if (key === "type" && value === "password") {
      return true;
    }
    if (key === "autocomplete" && (value === "current-password" || value === "new-password")) {
      return true;
    }
  }
  return false;
};
