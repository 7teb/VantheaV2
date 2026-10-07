export type SplitPart = { text: string; reasoning: string };

export type SplitEnd = SplitPart & { held: string };

export type ContentSplitter = { push(chunk: string): SplitPart; finish(): SplitEnd };

export const deepseek_calls_begin = "<｜tool▁calls▁begin｜>";

export const deepseek_call_begin = "<｜tool▁call▁begin｜>";

const think_tags = ["<think>", "</think>", "<thinking>", "</thinking>"];

const markers = [...think_tags, "<tool_call>", deepseek_calls_begin, deepseek_call_begin];

const longest_marker = Math.max(...markers.map((marker) => marker.length));

const text_pattern = new RegExp(`</?think(?:ing)?>|<tool_call>|${deepseek_calls_begin}|${deepseek_call_begin}`, "i");

const think_pattern = /<\/?think(?:ing)?>/i;

const partial_tail = (value: string): number => {
  const lower = value.toLowerCase();
  for (let length = Math.min(longest_marker - 1, value.length); length > 0; length -= 1) {
    const candidate = lower.slice(-length);
    if (markers.some((marker) => marker.length > length && marker.startsWith(candidate))) {
      return length;
    }
  }
  return 0;
};

const is_think_prefix = (value: string) => value.length > 1 && think_tags.some((tag) => tag.startsWith(value.toLowerCase()));

export const create_content_splitter = (): ContentSplitter => {
  let state: "text" | "think" | "held" = "text";
  let tail = "";
  let held = "";

  const push = (chunk: string): SplitPart => {
    const out: SplitPart = { text: "", reasoning: "" };
    if (state === "held") {
      held += chunk;
      return out;
    }
    let pending = tail + chunk;
    tail = "";
    for (;;) {
      const match = (state === "think" ? think_pattern : text_pattern).exec(pending);
      if (!match) {
        const keep = partial_tail(pending);
        const ready = pending.slice(0, pending.length - keep);
        if (state === "think") {
          out.reasoning += ready;
        } else {
          out.text += ready;
        }
        tail = pending.slice(pending.length - keep);
        return out;
      }
      const before = pending.slice(0, match.index);
      const tag = match[0].toLowerCase();
      pending = pending.slice(match.index + match[0].length);
      if (state === "think") {
        out.reasoning += before;
        state = tag.startsWith("</") ? "text" : "think";
        continue;
      }
      out.text += before;
      if (tag.startsWith("<think")) {
        state = "think";
        continue;
      }
      if (tag.startsWith("</")) {
        continue;
      }
      state = "held";
      held = match[0] + pending;
      return out;
    }
  };

  const finish = (): SplitEnd => {
    const rest = tail;
    tail = "";
    if (state === "held") {
      return { text: "", reasoning: "", held };
    }
    if (state === "think") {
      return { text: "", reasoning: is_think_prefix(rest) ? "" : rest, held: "" };
    }
    return { text: is_think_prefix(rest) ? "" : rest, reasoning: "", held: "" };
  };

  return { push, finish };
};
