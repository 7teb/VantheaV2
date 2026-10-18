import type { Dialect } from "./statements.ts";

const blank = (text: string) => text.replace(/[^\r\n]/g, " ");

const blank_powershell = (text: string): string => {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "`") {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char !== "'" && char !== '"') {
      out += char;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length) {
      const inner = text.charAt(end);
      if (char === '"' && inner === "`") {
        end += 2;
        continue;
      }
      if (inner === char && text.charAt(end + 1) === char) {
        end += 2;
        continue;
      }
      if (inner === char) {
        break;
      }
      end += 1;
    }
    out += char + blank(text.slice(index + 1, end)) + text.slice(end, end + 1);
    index = end + 1;
  }
  return out;
};

const blank_posix = (text: string): string => {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    const ansi = char === "$" && text.charAt(index + 1) === "'";
    const open = ansi ? index + 1 : index;
    const quote = text.charAt(open);
    if (quote !== "'" && quote !== '"') {
      out += char;
      index += 1;
      continue;
    }
    const escapes = ansi || quote === '"';
    let end = open + 1;
    while (end < text.length && text.charAt(end) !== quote) {
      end += escapes && text.charAt(end) === "\\" ? 2 : 1;
    }
    out += text.slice(index, open + 1) + blank(text.slice(open + 1, end)) + text.slice(end, end + 1);
    index = end + 1;
  }
  return out;
};

export const blank_quotes = (text: string, dialect: Dialect): string => (dialect === "posix" ? blank_posix(text) : blank_powershell(text));

const powershell_runners =
  /(?:^|[^\w-])(?:iex|invoke-expression|invoke-command|icm|start-process|saps|start|start-job|set-alias|sal|new-alias|nal|powershell|pwsh|cmd|bash|sh|wsl|runas|schtasks|wmic|invoke-wmimethod|invoke-cimmethod|scriptblock)(?:\.exe)?(?![\w-])/i;

const posix_runners =
  /(?:^|[^\w-])(?:eval|exec|source|xargs|watch|script|su|sudo|runas|bash|sh|zsh|dash|ksh|fish|busybox|powershell|pwsh|cmd|wsl|schtasks|wmic)(?:\.exe)?(?![\w-])/i;

const executes_powershell = (bare: string, text: string) =>
  /(?<![&>])&(?!&)/.test(bare) ||
  /(?:^|[;|({]|&&)\s*\.\s/.test(bare) ||
  /[{]/.test(bare) ||
  /\.invoke\w*\s*\(|::create\s*\(/i.test(bare) ||
  powershell_runners.test(bare) ||
  text.includes("$(");

const executes_posix = (bare: string, text: string) =>
  /(?:^|[;|({]|&&)\s*\.\s/.test(bare) ||
  /[{]/.test(bare) ||
  /(?:^|\s)[-/][a-z]*[ck](?=\s|$)/i.test(bare) ||
  posix_runners.test(bare) ||
  text.includes("$(") ||
  text.includes("`");

export const literal_view = (command: string, dialect: Dialect): ((statement: string) => string) => {
  const bare = blank_quotes(command, dialect);
  const executes = dialect === "posix" ? executes_posix(bare, command) : executes_powershell(bare, command);
  return executes ? (statement) => statement : (statement) => blank_quotes(statement, dialect);
};
