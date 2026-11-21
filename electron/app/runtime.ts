let headless = false;

let guarded: readonly string[] = [];

export const set_headless = (): void => {
  headless = true;
};

export const is_headless = (): boolean => headless;

export const set_guarded_roots = (roots: readonly string[]): void => {
  guarded = roots;
};

export const guarded_roots = (): readonly string[] => guarded;
