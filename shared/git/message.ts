const own_line = /^(?:[-*] |\d+\. |#|\s)/;

const joins = (previous: string, line: string): boolean => previous !== "" && line !== "" && !own_line.test(previous) && !own_line.test(line);

export const reflow_message = (text: string): string => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let reflowed = lines[0] ?? "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    reflowed += (joins(lines[index - 1] ?? "", line) ? " " : "\n") + line;
  }
  return reflowed;
};
