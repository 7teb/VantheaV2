const hidden = /[\p{C}\p{Z}]/u;

const escape_code = (code: number): string => {
  if (code <= 0xff) {
    return `\\x${code.toString(16).padStart(2, "0")}`;
  }
  if (code <= 0xffff) {
    return `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return `\\U${code.toString(16).padStart(8, "0")}`;
};

const escape_char = (char: string, quote: string): string => {
  if (char === quote || char === "\\") {
    return `\\${char}`;
  }
  if (char === "\n") {
    return "\\n";
  }
  if (char === "\r") {
    return "\\r";
  }
  if (char === "\t") {
    return "\\t";
  }
  if (char !== " " && hidden.test(char)) {
    return escape_code(char.codePointAt(0) ?? 0);
  }
  return char;
};

export const py_str = (value: string): string => {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  return `${quote}${Array.from(value, (char) => escape_char(char, quote)).join("")}${quote}`;
};

export const py_fixed = (value: number, digits: number): string => {
  const exact = value.toFixed(digits + 20);
  const point = exact.indexOf(".");
  const tail = exact.slice(point + 1 + digits);
  if (!/^50*$/.test(tail)) {
    return value.toFixed(digits);
  }
  const rounded_down = exact.slice(0, point + 1 + digits).replace(/\.$/, "");
  const last = Number(rounded_down.replace(".", "").slice(-1));
  return last % 2 === 0 ? rounded_down : value.toFixed(digits);
};
