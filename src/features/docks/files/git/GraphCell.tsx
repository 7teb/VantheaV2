import { memo, useId, type ReactNode } from "react";
import type { GraphRow } from "../../../../../shared/git-view.ts";

export const graph_row_height = 26;

const node_y = 13;

export const lane_x = (lane: number): number => 10 + lane * 12;

export const graph_width = (row: GraphRow): number => lane_x(row.width - 1) + 10;

const lane_color = (color: number): string => `var(--graph-lane-${(color % 6) + 1})`;

const edge_path = (x0: number, y0: number, x1: number, y1: number): string => {
  if (x0 === x1) {
    return `M${x0} ${y0}V${y1}`;
  }
  const middle = (y0 + y1) / 2;
  return `M${x0} ${y0}C${x0} ${middle} ${x1} ${middle} ${x1} ${y1}`;
};

const circle_path = (x: number, y: number, radius: number): string => `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;

type GraphNode = { cut: number; shape: ReactNode };

const graph_node = (x: number, color: string, head: boolean, merge: boolean): GraphNode => {
  if (head) {
    return { cut: 5, shape: <circle cx={x} cy={node_y} r={5} style={{ fill: color }} /> };
  }
  if (merge) {
    return {
      cut: 6,
      shape: (
        <>
          <circle className="git-graph-node" cx={x} cy={node_y} r={5} style={{ stroke: color }} />
          <circle cx={x} cy={node_y} r={1} style={{ fill: color }} />
        </>
      ),
    };
  }
  return { cut: 5, shape: <circle className="git-graph-node" cx={x} cy={node_y} r={4} style={{ stroke: color }} /> };
};

type GraphCellProps = { row: GraphRow; head: boolean };

export const GraphCell = memo(({ row, head }: GraphCellProps) => {
  const clip = `graph-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const width = graph_width(row);
  const x = lane_x(row.col);
  const node = graph_node(x, lane_color(row.color), head, row.parents.length > 1);
  return (
    <svg className="git-graph" width={width} height={graph_row_height} viewBox={`0 0 ${width} ${graph_row_height}`} aria-hidden="true">
      <clipPath id={clip}>
        <path clipRule="evenodd" d={`M0 0H${width}V${graph_row_height}H0Z${circle_path(x, node_y, node.cut)}`} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {row.up.map((edge, index) => (
          <path key={`up:${index}`} d={edge_path(lane_x(edge.from), 0, lane_x(edge.to), node_y)} style={{ stroke: lane_color(edge.color) }} />
        ))}
        {row.down.map((edge, index) => (
          <path key={`down:${index}`} d={edge_path(lane_x(edge.from), node_y, lane_x(edge.to), graph_row_height)} style={{ stroke: lane_color(edge.color) }} />
        ))}
      </g>
      {node.shape}
    </svg>
  );
});
