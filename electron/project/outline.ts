import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { OutlineSymbol } from "../../shared/tool-view.ts";

type Rule = { kind: string; pattern: RegExp };

const max_symbols = 300;

const max_scan_lines = 50_000;

const control_words = new Set(["if", "for", "while", "switch", "catch", "return", "else", "do", "try", "new", "delete", "throw", "sizeof", "await", "typeof", "using", "case"]);

const rules: Rule[] = [
  { kind: "class", pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/ },
  { kind: "enum", pattern: /^\s*(?:export\s+)?(?:const\s+)?enum\s+(?:class\s+)?([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/ },
  { kind: "const", pattern: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  { kind: "function", pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/ },
  { kind: "struct", pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/ },
  { kind: "trait", pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/ },
  { kind: "impl", pattern: /^\s*impl(?:<[^>]*>)?\s+([A-Za-z_][\w:<>, ]*?)\s*(?:\{|$|where)/ },
  { kind: "namespace", pattern: /^\s*(?:namespace|mod|module)\s+([A-Za-z_][\w.:]*)/ },
  { kind: "function", pattern: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
  { kind: "type", pattern: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/ },
  { kind: "function", pattern: /^\s*(?:(?:static|inline|constexpr|virtual|extern)\s+)*auto\s+([A-Za-z_~][\w:~]*)\s*\(/ },
  {
    kind: "method",
    pattern:
      /^\s*(?:(?:public|private|protected|internal)\s+)(?:(?:static|async|override|virtual|abstract|sealed|readonly|final|synchronized|extern|unsafe|new)\s+)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(/,
  },
  {
    kind: "function",
    pattern: /^(?!(?:return|else|new|delete|throw|await|yield|export|import|typeof|case|goto|using)\b)(?:[\w:*&<>,]+\s+)+\**&?([A-Za-z_~][\w:~]*)\s*\([^;]*$/,
  },
];

const indent_width = (line: string) => {
  let width = 0;
  for (const char of line) {
    if (char === " ") {
      width += 1;
    } else if (char === "\t") {
      width += 4;
    } else {
      break;
    }
  }
  return width;
};

export const outline_line = (line: string): { kind: string; name: string } | null => {
  for (const rule of rules) {
    const name = rule.pattern.exec(line)?.[1]?.trim();
    if (name && !control_words.has(name)) {
      return { kind: rule.kind, name };
    }
  }
  return null;
};

export const file_outline = async (file: string): Promise<{ symbols: OutlineSymbol[]; capped: boolean }> => {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const symbols: OutlineSymbol[] = [];
  const open: number[] = [];
  let number = 0;
  let capped = false;
  try {
    for await (const line of lines) {
      number += 1;
      if (number > max_scan_lines || symbols.length >= max_symbols) {
        capped = true;
        break;
      }
      const found = outline_line(line);
      if (!found) {
        continue;
      }
      const indent = indent_width(line);
      while (open.length && (open.at(-1) ?? 0) >= indent) {
        open.pop();
      }
      symbols.push({ kind: found.kind, name: found.name, line: number, depth: open.length });
      open.push(indent);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return { symbols, capped };
};
