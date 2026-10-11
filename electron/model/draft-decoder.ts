import { draft_tools, lines_after } from "../../shared/tool-drafts.ts";

export type DraftTake = { delta: string; lines: number; path: string | null; old_text: string | null };

export type DraftSource = { pending(): boolean; take(): DraftTake };

export type DraftDecoder = DraftSource & { feed(chunk: string): void };

const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

const hex_digits = /^[0-9a-fA-F]{4}$/;

const is_space = (char: string) => char === " " || char === "\n" || char === "\r" || char === "\t";

const is_high_surrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

type Piece = { text: string; next: number; closed: boolean };

const decode_string = (raw: string, from: number): Piece => {
  let text = "";
  let run = from;
  let at = from;
  while (at < raw.length) {
    const char = raw[at];
    if (char === '"') {
      return { text: text + raw.slice(run, at), next: at + 1, closed: true };
    }
    if (char !== "\\") {
      at += 1;
      continue;
    }
    text += raw.slice(run, at);
    if (at + 1 >= raw.length) {
      return { text, next: at, closed: false };
    }
    const kind = raw[at + 1];
    if (kind === "u") {
      if (at + 6 > raw.length) {
        return { text, next: at, closed: false };
      }
      const digits = raw.slice(at + 2, at + 6);
      text += hex_digits.test(digits) ? String.fromCharCode(Number.parseInt(digits, 16)) : raw.slice(at, at + 6);
      at += 6;
    } else {
      text += escapes[kind] ?? kind;
      at += 2;
    }
    run = at;
  }
  return { text: text + raw.slice(run, at), next: at, closed: false };
};

const skip_string = (raw: string, from: number): { next: number; closed: boolean } => {
  let at = from;
  while (at < raw.length) {
    const char = raw[at];
    if (char === '"') {
      return { next: at + 1, closed: true };
    }
    if (char !== "\\") {
      at += 1;
      continue;
    }
    if (at + 1 >= raw.length) {
      return { next: at, closed: false };
    }
    at += 2;
  }
  return { next: at, closed: false };
};

type Mode = "open" | "key" | "key_text" | "colon" | "value" | "text" | "skip_text" | "nested" | "scalar" | "next" | "done";

type Target = "path" | "before" | "text";

export const create_draft_decoder = (name: string): DraftDecoder | null => {
  const fields = draft_tools.get(name);
  if (!fields) {
    return null;
  }
  let held = "";
  let mode: Mode = "open";
  let key = "";
  let target: Target | null = null;
  let buffer = "";
  let depth = 0;
  let nested_string = false;
  let text_started = false;
  let text_closed = false;
  let unsent = "";
  let lines = 0;
  let path: string | null = null;
  let path_sent = false;
  let before: string | null = null;
  let before_sent = false;

  const target_for = (field: string): Target | null => {
    if (field === "path" && path === null) {
      return "path";
    }
    if (field === fields.text && !text_started) {
      text_started = true;
      return "text";
    }
    if (field === fields.before && !text_started && before === null) {
      return "before";
    }
    return null;
  };

  const absorb = (text: string) => {
    if (target === "text") {
      unsent += text;
      return;
    }
    buffer += text;
  };

  const close_target = () => {
    if (target === "path") {
      path = buffer;
    } else if (target === "before") {
      before = buffer;
    } else {
      text_closed = true;
    }
    buffer = "";
    target = null;
  };

  const skip_nested = (raw: string, from: number): { next: number; closed: boolean } => {
    let at = from;
    while (at < raw.length) {
      const char = raw[at];
      if (nested_string) {
        if (char === "\\") {
          if (at + 1 >= raw.length) {
            return { next: at, closed: false };
          }
          at += 2;
          continue;
        }
        if (char === '"') {
          nested_string = false;
        }
        at += 1;
        continue;
      }
      if (char === '"') {
        nested_string = true;
      } else if (char === "{" || char === "[") {
        depth += 1;
      } else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          return { next: at + 1, closed: true };
        }
      }
      at += 1;
    }
    return { next: at, closed: false };
  };

  const expect = (char: string, wanted: string, then: Mode) => {
    if (char === wanted) {
      mode = then;
    } else if (!is_space(char)) {
      mode = "done";
    }
  };

  const consume = (raw: string): number => {
    let at = 0;
    while (at < raw.length) {
      const char = raw[at];
      switch (mode) {
        case "open":
          expect(char, "{", "key");
          at += 1;
          break;
        case "key":
          if (char === '"') {
            mode = "key_text";
            key = "";
          } else if (char !== "," && !is_space(char)) {
            mode = "done";
          }
          at += 1;
          break;
        case "key_text": {
          const piece = decode_string(raw, at);
          key += piece.text;
          at = piece.next;
          if (!piece.closed) {
            return at;
          }
          mode = "colon";
          break;
        }
        case "colon":
          expect(char, ":", "value");
          at += 1;
          break;
        case "value":
          if (is_space(char)) {
            at += 1;
          } else if (char === '"') {
            target = target_for(key);
            mode = target ? "text" : "skip_text";
            at += 1;
          } else if (char === "{" || char === "[") {
            depth = 1;
            nested_string = false;
            mode = "nested";
            at += 1;
          } else {
            mode = "scalar";
          }
          break;
        case "text": {
          const piece = decode_string(raw, at);
          absorb(piece.text);
          at = piece.next;
          if (!piece.closed) {
            return at;
          }
          close_target();
          mode = "next";
          break;
        }
        case "skip_text":
        case "nested": {
          const skipped = mode === "nested" ? skip_nested(raw, at) : skip_string(raw, at);
          at = skipped.next;
          if (!skipped.closed) {
            return at;
          }
          mode = "next";
          break;
        }
        case "scalar":
          if (char === "," || char === "}" || is_space(char)) {
            mode = "next";
          } else {
            at += 1;
          }
          break;
        case "next":
          if (char === ",") {
            mode = "key";
          } else if (!is_space(char)) {
            mode = "done";
          }
          at += 1;
          break;
        case "done":
          return raw.length;
      }
    }
    return at;
  };

  const pending = () => {
    if ((path !== null && !path_sent) || (before !== null && !before_sent)) {
      return true;
    }
    if (!unsent) {
      return false;
    }
    return text_closed || unsent.length > 1 || !is_high_surrogate(unsent.charCodeAt(0));
  };

  const take = (): DraftTake => {
    let delta = unsent;
    unsent = "";
    if (!text_closed && delta && is_high_surrogate(delta.charCodeAt(delta.length - 1))) {
      unsent = delta.slice(-1);
      delta = delta.slice(0, -1);
    }
    lines = lines_after(lines, delta);
    const out: DraftTake = { delta, lines, path: path_sent ? null : path, old_text: before_sent ? null : before };
    path_sent ||= path !== null;
    before_sent ||= before !== null;
    return out;
  };

  return {
    feed: (chunk) => {
      const raw = held + chunk;
      held = raw.slice(consume(raw));
    },
    pending,
    take,
  };
};
