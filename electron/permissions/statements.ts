const closers: Record<string, string> = { "(": ")", "{": "}" };

const skip_quoted = (source: string, start: number): number => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (quote === '"' && char === "`") {
      index += 2;
      continue;
    }
    if (char === quote) {
      if (source[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    if (quote === '"' && char === "$" && source[index + 1] === "(") {
      index = skip_group(source, index + 1);
      continue;
    }
    index += 1;
  }
  return source.length;
};

const skip_group = (source: string, start: number): number => {
  const close = closers[source[start] ?? ""];
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "'" || char === '"') {
      index = skip_quoted(source, index);
      continue;
    }
    if (char === "`") {
      index += 2;
      continue;
    }
    if (char === source[start]) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
};

const inner_groups = (text: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "'") {
      index = skip_quoted(text, index);
      continue;
    }
    if (char === '"') {
      const end = skip_quoted(text, index);
      groups.push(...inner_groups_in_string(text.slice(index + 1, end - 1)));
      index = end;
      continue;
    }
    if (char === "`") {
      index += 2;
      continue;
    }
    if (char === "(" || char === "{") {
      const end = skip_group(text, index);
      groups.push(text.slice(index + 1, Math.max(index + 1, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

const inner_groups_in_string = (text: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      index += 2;
      continue;
    }
    if (text[index] === "$" && text[index + 1] === "(") {
      const end = skip_group(text, index + 1);
      groups.push(text.slice(index + 2, Math.max(index + 2, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

const at_token_start = (text: string) => text === "" || /[\s;|&(){}]$/.test(text);

const split_top_level = (source: string, split_pipes: boolean): string[] => {
  const parts: string[] = [];
  let current = "";
  let index = 0;
  const flush = () => {
    const text = current.trim();
    if (text) {
      parts.push(text);
    }
    current = "";
  };
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "'" || char === '"') {
      const end = skip_quoted(source, index);
      current += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === "`") {
      const next = source[index + 1] ?? "";
      current += next === "\n" || next === "\r" ? " " : char + next;
      index += next === "\r" && source[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (char === "(" || char === "{") {
      const end = skip_group(source, index);
      current += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === "<" && source[index + 1] === "#" && at_token_start(current)) {
      const end = source.indexOf("#>", index + 2);
      current += " ";
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "#" && at_token_start(current)) {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "|" && !split_pipes && source[index + 1] !== "|") {
      current += char;
      index += 1;
      continue;
    }
    if (char === ";" || char === "\n" || char === "\r" || char === "|") {
      flush();
      index += source[index + 1] === char && char !== "\n" ? 2 : 1;
      continue;
    }
    if (char === "&" && source[index + 1] === "&") {
      flush();
      index += 2;
      continue;
    }
    current += char;
    index += 1;
  }
  flush();
  return parts;
};

const shell_launch = /^(?:&\s*)?["']?(?:[^"'\s]*[\\/])?(powershell|pwsh|cmd)(?:\.exe)?["']?(?=\s|$)([\s\S]*)$/i;

const unquote = (text: string) => {
  const value = text.trim();
  const quoted = value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
};

const nested_payloads = (statement: string): string[] => {
  const match = shell_launch.exec(statement.trim());
  if (!match) {
    return [];
  }
  const rest = match[2] ?? "";
  if ((match[1] ?? "").toLowerCase() === "cmd") {
    const payload = /(?:^|\s)\/[ck]\s+([\s\S]*)$/i.exec(rest);
    return payload ? [unquote(payload[1] ?? "").replace(/(?<!&)&(?!&)/g, ";")] : [];
  }
  const encoded = /(?:^|\s)-(?:encodedcommand|enc|ec|e)\s+([A-Za-z0-9+/=]+)/i.exec(rest);
  if (encoded) {
    return [Buffer.from(encoded[1] ?? "", "base64").toString("utf16le")];
  }
  const payload = /(?:^|\s)-(?:command|c)\s+([\s\S]*)$/i.exec(rest);
  return payload ? [unquote(payload[1] ?? "")] : [];
};

const split_recursive = (command: string, split_pipes: boolean): string[] => {
  const statements: string[] = [];
  const pending = [command];
  while (pending.length) {
    const source = pending.shift() ?? "";
    for (const statement of split_top_level(source, split_pipes)) {
      statements.push(statement);
      pending.push(...inner_groups(statement), ...nested_payloads(statement));
    }
  }
  return statements;
};

export const split_statements = (command: string): string[] => split_recursive(command, true);

export const split_pipelines = (command: string): string[] => split_recursive(command, false);
