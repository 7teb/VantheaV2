const own_line = /^(?:[-*] |\d+\. |#|\s)/;

const trailer_line = /^[A-Za-z0-9][A-Za-z0-9-]*:/;

const joins = (previous: string, line: string): boolean => previous !== "" && line !== "" && !own_line.test(previous) && !own_line.test(line);

export const reflow_message = (text: string): string => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && lines[start - 1].trim()) {
    start -= 1;
  }
  const trailers = lines.slice(start, end);
  const preserves = trailers.some((line) => trailer_line.test(line)) && trailers.every((line, index) => trailer_line.test(line) || (index > 0 && /^\s/.test(line)));
  let reflowed = lines[0] ?? "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    reflowed += (!(preserves && index >= start && index < end) && joins(lines[index - 1] ?? "", line) ? " " : "\n") + line;
  }
  return reflowed;
};
