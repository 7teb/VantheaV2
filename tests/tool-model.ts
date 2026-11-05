import type { ModelEntry } from "../shared/models.ts";

export const tool_model: ModelEntry = {
  id: "test/model",
  label: "Test model",
  provider: "test",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 200_000,
  max_output: 8192,
  reasoning_passback: false,
};
