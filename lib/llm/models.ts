export type ModelId =
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-pro"
  | "anthropic/claude-sonnet-4.6"
  | "anthropic/claude-opus-4.7";

export const MODELS: ReadonlyArray<{
  id: ModelId;
  label: string;
  note: string;
}> = [
  { id: "google/gemini-2.5-flash",   label: "Fast & cheap (default)", note: "Cheapest PDF-capable option." },
  { id: "google/gemini-2.5-pro",     label: "Higher quality",          note: "Better on dense statements." },
  { id: "anthropic/claude-sonnet-4.6", label: "High quality",          note: "Strong structured-output reliability." },
  { id: "anthropic/claude-opus-4.7",   label: "Highest quality",       note: "Most expensive." },
];

export const ALLOWED_MODEL_IDS = new Set<ModelId>(MODELS.map((m) => m.id));
export const DEFAULT_MODEL: ModelId = "google/gemini-2.5-flash";

export function assertAllowedModel(id: string): asserts id is ModelId {
  if (!ALLOWED_MODEL_IDS.has(id as ModelId)) {
    throw new Error(`Model not allowed: ${id}`);
  }
}
