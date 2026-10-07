export const class_names = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
