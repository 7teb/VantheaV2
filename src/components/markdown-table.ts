import type { Element, Root } from "hast";

const child_elements = (node: Element, tag_names: string[]): Element[] =>
  node.children.filter((child): child is Element => child.type === "element" && tag_names.includes(child.tagName));

const text_length = (node: Element): number =>
  node.children.reduce((total, child) => {
    if (child.type === "text") {
      return total + child.value.length;
    }
    return child.type === "element" ? total + text_length(child) : total;
  }, 0);

type ColumnSize = "sm" | "md" | "lg" | "xl";

const column_min_width: Record<ColumnSize, number> = { sm: 128, md: 192, lg: 256, xl: 448 };

const content_width = 720;

const column_size = (length: number): ColumnSize => {
  if (length <= 40) {
    return "sm";
  }
  if (length <= 100) {
    return "md";
  }
  return length <= 160 ? "lg" : "xl";
};

const size_columns = (table: Element) => {
  const rows = child_elements(table, ["thead", "tbody"])
    .flatMap((section) => child_elements(section, ["tr"]))
    .map((row) => child_elements(row, ["th", "td"]));
  const lengths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      lengths[index] = Math.max(lengths[index] ?? 0, text_length(cell));
    });
  }
  const sizes = lengths.map(column_size);
  for (const row of rows) {
    row.forEach((cell, index) => {
      cell.properties.dataColSize = sizes[index];
    });
  }
  if (sizes.reduce((total, size) => total + column_min_width[size], 0) <= content_width) {
    table.properties.dataColMin = true;
  }
};

const visit_tables = (node: Root | Element) => {
  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tagName === "table") {
      size_columns(child);
      continue;
    }
    visit_tables(child);
  }
};

export const rehype_table_columns = () => (tree: Root) => visit_tables(tree);
