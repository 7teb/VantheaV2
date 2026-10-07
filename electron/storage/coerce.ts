export const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const as_record = (value: unknown): Record<string, unknown> => (is_record(value) ? value : {});

export const as_string = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

export const as_number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const as_boolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

export const as_array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((entry) => entry === value) ?? fallback;

export const as_iso = (value: unknown, fallback: string): string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;

export const clamp_int = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, Math.round(as_number(value, fallback))));

export const require_string = (value: unknown, label: string, max_length = 100_000): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (value.length > max_length) {
    throw new Error(`${label} is longer than ${max_length} characters`);
  }
  return value;
};

export const require_record = (value: unknown, label: string): Record<string, unknown> => {
  if (!is_record(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

export const optional_string = (raw: Record<string, unknown>, key: string, label: string): string | undefined =>
  raw[key] === undefined ? undefined : require_string(raw[key], label, 1000);

export const optional_boolean = (raw: Record<string, unknown>, key: string, label: string): boolean | undefined => {
  const value = raw[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
};

export const error_code = (error: unknown): string =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";

export const error_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));
