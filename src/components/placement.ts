export type Side = "top" | "bottom" | "left" | "right";

export type Align = "start" | "center" | "end";

export type Placement = `${Side}-${Align}`;

export type Box = { left: number; top: number; width: number; height: number };

export type Size = { width: number; height: number };

export type Placed = { left: number; top: number; side: Side };

const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

const space = (side: Side, anchor: Box, viewport: Size, gap: number, margin: number) => {
  switch (side) {
    case "top":
      return anchor.top - gap - margin;
    case "bottom":
      return viewport.height - (anchor.top + anchor.height) - gap - margin;
    case "left":
      return anchor.left - gap - margin;
    case "right":
      return viewport.width - (anchor.left + anchor.width) - gap - margin;
  }
};

const extent = (side: Side, size: Size) => (side === "top" || side === "bottom" ? size.height : size.width);

const aligned = (align: Align, start: number, length: number, size: number) => {
  if (align === "start") {
    return start;
  }
  if (align === "end") {
    return start + length - size;
  }
  return start + (length - size) / 2;
};

const clamp = (value: number, size: number, limit: number, margin: number) =>
  Math.max(margin, Math.min(value, limit - margin - size));

export const place = (anchor: Box, size: Size, placement: Placement, viewport: Size, gap = 6, margin = 8): Placed => {
  const [preferred, align] = placement.split("-") as [Side, Align];
  const fits = space(preferred, anchor, viewport, gap, margin) >= extent(preferred, size);
  const flipped = opposite[preferred];
  const side = fits || space(flipped, anchor, viewport, gap, margin) <= space(preferred, anchor, viewport, gap, margin) ? preferred : flipped;

  if (side === "top" || side === "bottom") {
    const top = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - gap - size.height;
    const left = aligned(align, anchor.left, anchor.width, size.width);
    return {
      side,
      left: Math.round(clamp(left, size.width, viewport.width, margin)),
      top: Math.round(clamp(top, size.height, viewport.height, margin)),
    };
  }
  const left = side === "right" ? anchor.left + anchor.width + gap : anchor.left - gap - size.width;
  const top = aligned(align, anchor.top, anchor.height, size.height);
  return {
    side,
    left: Math.round(clamp(left, size.width, viewport.width, margin)),
    top: Math.round(clamp(top, size.height, viewport.height, margin)),
  };
};
