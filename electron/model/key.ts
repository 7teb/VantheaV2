let key_source: () => string = () => "";

export const set_key_source = (source: () => string) => {
  key_source = source;
};

export const current_key = (): string => key_source().trim();

export const redact_key = (text: string): string => {
  const key = current_key();
  return key ? text.replaceAll(key, "[redacted]") : text;
};
