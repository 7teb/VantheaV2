export type SkillFile = { name: string; description: string; body: string };

export type SkillParse = { ok: true; skill: SkillFile } | { ok: false; error: string };

export const max_skill_bytes = 100 * 1024;

const max_description_chars = 1000;

const max_name_chars = 80;

const key_line = /^([^\s#][^:]*):(?:\s+(.*))?$/;

const block_header = /^([|>])[+-]?\d?[+-]?\s*(?:#.*)?$/;

const nested_line = /^(?:-(?:\s|$)|[^\s#][^:]*:(?:\s|$))/;

export const skill_slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 60)
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");

const indentation = (line: string) => line.length - line.trimStart().length;

const block_scalar = (folded: boolean, block: string[]): string => {
  const first = block.find((line) => line.trim());
  if (!first) {
    return "";
  }
  const indent = indentation(first);
  const lines = block.map((line) => (line.trim() ? line.slice(Math.min(indent, indentation(line))) : ""));
  if (!folded) {
    return lines.join("\n").trim();
  }
  const paragraphs: string[][] = [[]];
  for (const line of lines) {
    if (line) {
      paragraphs.at(-1)?.push(line.trim());
    } else if (paragraphs.at(-1)?.length) {
      paragraphs.push([]);
    }
  }
  return paragraphs
    .filter((paragraph) => paragraph.length)
    .map((paragraph) => paragraph.join(" "))
    .join("\n");
};

const closing_quote = (text: string, quote: string): number => {
  for (let index = 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] !== quote) {
      continue;
    }
    if (quote === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
};

const escapes: Record<string, string> = { n: "\n", t: "\t" };

const quoted_scalar = (rest: string, block: string[]): string => {
  const quote = rest.charAt(0);
  const joined = closing_quote(rest, quote) === -1 ? [rest, ...block.map((line) => line.trim()).filter(Boolean)].join(" ") : rest;
  const end = closing_quote(joined, quote);
  const inner = end === -1 ? joined.slice(1) : joined.slice(1, end);
  if (quote === "'") {
    return inner.replaceAll("''", "'");
  }
  return inner.replace(/\\./g, (sequence) => escapes[sequence.charAt(1)] ?? sequence.charAt(1));
};

const scalar_value = (rest: string, block: string[]): string => {
  const header = block_header.exec(rest);
  if (header) {
    return block_scalar(header[1] === ">", block);
  }
  if (rest.startsWith('"') || rest.startsWith("'")) {
    return quoted_scalar(rest, block);
  }
  const continuation = block.map((line) => line.trim()).filter(Boolean);
  if (!rest && nested_line.test(continuation[0] ?? "")) {
    return "";
  }
  return [rest.replace(/\s+#.*$/, ""), ...continuation].filter(Boolean).join(" ");
};

export const parse_frontmatter = (head: string): Record<string, string> => {
  const lines = head.split("\n");
  const meta: Record<string, string> = {};
  let index = 0;
  while (index < lines.length) {
    const match = key_line.exec(lines[index] ?? "");
    index += 1;
    if (!match) {
      continue;
    }
    const block: string[] = [];
    while (index < lines.length && /^(?:\s|$)/.test(lines[index] ?? "")) {
      block.push(lines[index] ?? "");
      index += 1;
    }
    meta[(match[1] ?? "").trim().toLowerCase()] = scalar_value((match[2] ?? "").trim(), block).trim();
  }
  return meta;
};

export const parse_skill_file = (raw: string): SkillParse => {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > max_skill_bytes) {
    return { ok: false, error: `SKILL.md is ${bytes} bytes, the limit is ${max_skill_bytes}` };
  }
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return { ok: false, error: "SKILL.md must start with a YAML frontmatter block delimited by ---" };
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (close === -1) {
    return { ok: false, error: "SKILL.md frontmatter is never closed with ---" };
  }
  const meta = parse_frontmatter(lines.slice(1, close).join("\n"));
  const name = meta.name ?? "";
  const description = meta.description ?? "";
  const body = lines.slice(close + 1).join("\n").trim();
  if (!name) {
    return { ok: false, error: "SKILL.md frontmatter has no name" };
  }
  if (name.length > max_name_chars) {
    return { ok: false, error: `The name is ${name.length} characters, the limit is ${max_name_chars} because it is sent with every request` };
  }
  if (!description) {
    return { ok: false, error: "SKILL.md frontmatter has no description, and the description is what tells the agent when to use the skill" };
  }
  if (description.length > max_description_chars) {
    return {
      ok: false,
      error: `The description is ${description.length} characters, the limit is ${max_description_chars} because it is sent with every request`,
    };
  }
  if (!skill_slug(name)) {
    return { ok: false, error: `The name "${name}" contains no usable characters for a folder name` };
  }
  if (!body) {
    return { ok: false, error: "SKILL.md has frontmatter but no body" };
  }
  return { ok: true, skill: { name, description, body } };
};
