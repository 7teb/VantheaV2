import { createHash } from "node:crypto";

export type MemoryKind = "global_preference" | "global_environment" | "project_rule";

export const memory_kinds: readonly MemoryKind[] = ["global_preference", "global_environment", "project_rule"];

const namespaces = new Set(["communication", "coding", "environment", "tooling", "workflow", "project"]);

const ignored_words = new Set([
  "aber", "auch", "dass", "eine", "einer", "eines", "immer", "nicht", "oder", "sein", "soll", "und", "user", "will",
  "about", "always", "does", "from", "have", "prefers", "should", "that", "their", "they", "this", "uses", "with",
]);

const key_pattern = /\b(?:sk|tvly)-[A-Za-z0-9_-]{10,}/g;

const assignment_pattern = /\b(api[_ -]?key|access[_ -]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi;

export const clean_text = (value: unknown, limit = 500): string =>
  (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, limit);

export const redact_secrets = (value: unknown, limit = 800): string =>
  clean_text(value, limit).replace(key_pattern, "[redacted]").replace(assignment_pattern, "$1=[redacted]");

export const contains_secret = (value: string): boolean => value.search(key_pattern) !== -1 || value.search(assignment_pattern) !== -1;

export const words_for = (value: string): Set<string> =>
  new Set((clean_text(value, 1000).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !ignored_words.has(word)));

export const similarity = (left: string, right: string): number => {
  const a = words_for(left);
  const b = words_for(right);
  if (!a.size || !b.size) {
    return 0;
  }
  let common = 0;
  for (const word of a) {
    if (b.has(word)) {
      common += 1;
    }
  }
  return common / Math.max(a.size, b.size);
};

const namespace_for = (kind: MemoryKind): string => {
  if (kind === "global_environment") {
    return "environment";
  }
  if (kind === "project_rule") {
    return "project";
  }
  return "workflow";
};

const fallback_key = (kind: MemoryKind, text: string): string => {
  const useful = [...words_for(clean_text(text, 300))].slice(0, 5);
  const suffix = useful.join("_") || createHash("sha256").update(text).digest("hex").slice(0, 12);
  return `${namespace_for(kind)}.${suffix}`;
};

export const normalize_memory_key = (value: unknown, kind: MemoryKind, text: string): string => {
  const raw = clean_text(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/[-_]{2,}/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
  const keyed = raw && namespaces.has(raw.split(".")[0] ?? "") ? raw : `${namespace_for(kind)}.${raw}`;
  return (keyed.endsWith(".") || keyed.length < 4 ? fallback_key(kind, text) : keyed).slice(0, 160);
};

export const memory_handle = (id: string): string => id.split("-").pop() ?? "";
