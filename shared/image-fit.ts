export type Size = { width: number; height: number };

export type NativeSize = { max_edge: number; patch: number; max_patches: number };

export const default_native: NativeSize = { max_edge: 1440, patch: 1, max_patches: 1_296_000 };

export const edge_rule = (max_edge: number): NativeSize => ({ max_edge, patch: 1, max_patches: Number.POSITIVE_INFINITY });

const patches = (value: number, patch: number) => Math.ceil(value / patch);

const fits = (width: number, height: number, rules: NativeSize[]): boolean =>
  rules.every(
    (rule) =>
      patches(width, rule.patch) * rule.patch <= rule.max_edge &&
      patches(height, rule.patch) * rule.patch <= rule.max_edge &&
      patches(width, rule.patch) * patches(height, rule.patch) <= rule.max_patches,
  );

const round_half_even = (value: number): number => {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
};

export const fit_image = (width: number, height: number, rules: NativeSize[]): Size => {
  if (fits(width, height, rules)) {
    return { width, height };
  }
  if (height > width) {
    const turned = fit_image(height, width, rules);
    return { width: turned.height, height: turned.width };
  }
  const aspect = width / height;
  const short_edge = (long_edge: number) => Math.max(1, round_half_even(long_edge / aspect));
  let low = 1;
  let high = width;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle, short_edge(middle), rules)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return { width: low, height: short_edge(low) };
};
