export type CodeTracker = { feed(text: string): void; skip(text: string): void; inside(): boolean };

type Fence = { char: string; length: number };

type Container = { kind: "quote" } | { kind: "list"; width: number };

type BlockState = { containers: Container[]; fence: Fence | null; paragraph: boolean };

const fence_open = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;

const fence_close = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;

const blank_line = /^[ \t\r]*$/;

const backtick_run = /(\\*)(`+)/g;

const opening_fence = (line: string): Fence | null => {
  const match = fence_open.exec(line);
  if (!match) {
    return null;
  }
  const run = match[1] ?? "";
  const info = match[2] ?? "";
  if (run.startsWith("`") && info.includes("`")) {
    return null;
  }
  return { char: run.charAt(0), length: run.length };
};

const inline_after = (line: string, open: number): number => {
  let current = open;
  for (const match of line.matchAll(backtick_run)) {
    const run = (match[2] ?? "").length;
    if (current) {
      current = run === current ? 0 : current;
      continue;
    }
    const escaped = (match[1] ?? "").length % 2 === 1;
    current = escaped ? run - 1 : run;
  }
  return current;
};

const expand_tabs = (source: string): string => {
  let line = "";
  for (const char of source) {
    line += char === "\t" ? " ".repeat(4 - line.length % 4) : char;
  }
  return line;
};

const code_line = (state: BlockState, source: string): boolean => {
  let line = expand_tabs(source);
  let matched = 0;
  for (const container of state.containers) {
    if (container.kind === "quote") {
      const prefix = /^ {0,3}> ?/.exec(line);
      if (!prefix) break;
      line = line.slice(prefix[0].length);
    } else {
      const leading = /^ */.exec(line)?.[0].length ?? 0;
      if (line.trim() && leading < container.width) break;
      line = line.slice(container.width);
    }
    matched += 1;
  }
  if (matched < state.containers.length) {
    state.containers.length = matched;
    state.fence = null;
  }
  if (state.fence) {
    const close = fence_close.exec(line);
    const run = close?.[1] ?? "";
    if (run.startsWith(state.fence.char) && run.length >= state.fence.length) {
      state.fence = null;
    }
    return true;
  }
  for (;;) {
    const quote = /^ {0,3}> ?/.exec(line);
    if (quote) {
      state.containers.push({ kind: "quote" });
      state.paragraph = false;
      line = line.slice(quote[0].length);
      continue;
    }
    const marker = /^( {0,3})([-+*]|(\d{1,9})[.)])( +|$)/.exec(line);
    if (!marker || (state.paragraph && (!line.slice(marker[0].length).trim() || (marker[3] !== undefined && marker[3] !== "1")))) break;
    const gap = marker[4].length;
    const width = marker[1].length + marker[2].length + (gap >= 1 && gap <= 4 ? gap : 1);
    state.containers.push({ kind: "list", width });
    state.paragraph = false;
    line = line.slice(width);
  }
  const opened = opening_fence(line);
  if (opened) {
    state.fence = opened;
    state.paragraph = false;
    return true;
  }
  if (blank_line.test(line)) {
    state.paragraph = false;
    return false;
  }
  if (line.startsWith("    ") && !state.paragraph) return true;
  const heading = state.paragraph && /^ {0,3}(?:=+|-+) *$/.test(line);
  state.paragraph = !heading && !/^ {0,3}(?:#{1,6}(?: |$)|(?:\* *){3,}$|(?:_ *){3,}$|(?:- *){3,}$)/.test(line);
  return false;
};

export const create_code_tracker = (): CodeTracker => {
  const block: BlockState = { containers: [], fence: null, paragraph: false };
  let inline = 0;
  let line = "";

  const end_line = (value: string) => {
    const code = code_line(block, value);
    if (code || blank_line.test(value)) {
      inline = 0;
    } else {
      inline = inline_after(value, inline);
    }
  };

  const feed = (text: string) => {
    const lines = text.split("\n");
    if (lines.length === 1) {
      line += text;
      return;
    }
    end_line(line + lines[0]);
    for (const value of lines.slice(1, -1)) {
      end_line(value);
    }
    line = lines.at(-1) ?? "";
  };

  const skip = (text: string) => {
    line += text.replace(/[`\r\n]/g, "");
  };

  const inside = () => {
    const probe = { ...block, containers: [...block.containers] };
    const code = code_line(probe, line + "x");
    return code || inline_after(line, inline) !== 0;
  };

  return { feed, skip, inside };
};
