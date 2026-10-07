import { class_names } from "./class-names.ts";
import "./Skeleton.css";

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
};

export const Skeleton = ({ width = "100%", height = 14, radius = 6, className }: SkeletonProps) => (
  <span className={class_names("skeleton", className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />
);

type SkeletonLinesProps = { widths: number[]; height?: number; gap?: number; className?: string };

export const SkeletonLines = ({ widths, height = 12, gap = 10, className }: SkeletonLinesProps) => (
  <span className={class_names("skeleton-lines", className)} style={{ gap }} aria-hidden="true">
    {widths.map((width, index) => (
      <Skeleton key={index} width={`${width}%`} height={height} radius={5} />
    ))}
  </span>
);

type SkeletonRowsProps = { widths: number[]; row_height?: number; icon?: boolean; className?: string };

export const SkeletonRows = ({ widths, row_height = 34, icon = false, className }: SkeletonRowsProps) => (
  <span className={class_names("skeleton-rows", className)} aria-hidden="true">
    {widths.map((width, index) => (
      <span key={index} className="skeleton-row" style={{ height: row_height }}>
        {icon && <Skeleton width={16} height={16} radius={5} />}
        <Skeleton width={`${width}%`} height={12} radius={5} />
      </span>
    ))}
  </span>
);

type SkeletonBubbleProps = { width: number | string; height: number; className?: string };

export const SkeletonBubble = ({ width, height, className }: SkeletonBubbleProps) => (
  <Skeleton width={width} height={height} radius={18} className={class_names("skeleton-bubble", className)} />
);
