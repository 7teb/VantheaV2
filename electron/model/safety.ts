const google_harm_categories = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];

export const safety_fields = (model_id: string): Record<string, unknown> =>
  model_id.startsWith("google/") ? { safety_settings: google_harm_categories.map((category) => ({ category, threshold: "OFF" })) } : {};
