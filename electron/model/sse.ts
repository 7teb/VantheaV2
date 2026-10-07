export type SseItem = { kind: "event"; event: string; data: string } | { kind: "comment"; text: string };

export type SseParser = { feed(text: string): SseItem[]; end(): SseItem[] };

export const create_sse_parser = (): SseParser => {
  let buffer = "";
  let scanned = 0;
  let data: string[] = [];
  let event = "";

  const dispatch = (out: SseItem[]) => {
    if (data.length) {
      out.push({ kind: "event", event: event || "message", data: data.join("\n") });
    }
    data = [];
    event = "";
  };

  const line = (text: string, out: SseItem[]) => {
    if (!text) {
      dispatch(out);
      return;
    }
    if (text.startsWith(":")) {
      out.push({ kind: "comment", text: text.slice(1).replace(/^ /, "") });
      return;
    }
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? "" : text.slice(colon + 1).replace(/^ /, "");
    if (field === "data") {
      data.push(value);
    } else if (field === "event") {
      event = value;
    }
  };

  const drain = (final: boolean): SseItem[] => {
    const out: SseItem[] = [];
    let start = 0;
    let index = scanned;
    while (index < buffer.length) {
      const char = buffer[index];
      if (char !== "\n" && char !== "\r") {
        index += 1;
        continue;
      }
      if (char === "\r" && index + 1 === buffer.length && !final) {
        break;
      }
      line(buffer.slice(start, index), out);
      index += char === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      start = index;
    }
    buffer = buffer.slice(start);
    scanned = index - start;
    return out;
  };

  return {
    feed: (text) => {
      buffer += text;
      return drain(false);
    },
    end: () => {
      const out = drain(true);
      buffer = "";
      scanned = 0;
      data = [];
      event = "";
      return out;
    },
  };
};
