export type ModelRoute = { id: string; label: string; provider_order: string[] };

export type ModelEntry = {
  id: string;
  label: string;
  provider: string;
  provider_order: string[];
  efforts: string[];
  default_effort: string;
  vision: boolean;
  context_length: number;
  max_output: number;
  reasoning_passback: boolean;
  note?: string;
  fallback?: ModelRoute;
};

export type SideModelRole = "title" | "overseer" | "vision" | "summarize" | "web_answer" | "memory";

export type ImageModelEntry = { id: string; label: string; quality: boolean };

export type ModelCatalog = {
  models: ModelEntry[];
  side: Record<SideModelRole, string>;
  image_models: ImageModelEntry[];
};
