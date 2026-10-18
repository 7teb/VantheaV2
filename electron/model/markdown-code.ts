export type CodeTracker = { feed(text: string): void; skip(text: string): void; inside(): boolean };

type Fence = { char: string; length: number };

const fence_open = /^[ \t]*(`{3,}|~{3,})([\s\S]*)$/;

const fence_close = /^[ \t]*(`{3,}|~{3,})[ \t\r]*$/;

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

export const create_code_tracker = (): CodeTracker => {
  let fence: Fence | null = null;
  let inline = 0;
  let line = "";

  const end_line = (value: string) => {
    if (fence) {
      const close = fence_close.exec(value);
      const run = close?.[1] ?? "";
      if (run.startsWith(fence.char) && run.length >= fence.length) {
        fence = null;
      }
      return;
    }
    const opened = opening_fence(value);
    if (opened) {
      fence = opened;
      inline = 0;
      return;
    }
    inline = blank_line.test(value) ? 0 : inline_after(value, inline);
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

  const inside = () => fence !== null || opening_fence(line) !== null || inline_after(line, inline) !== 0;

  return { feed, skip, inside };
};
