export type JsonRecord = Record<string, unknown>;

export const as_record = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

export const as_string = (value: unknown): string => (typeof value === "string" ? value : "");

export const as_number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
