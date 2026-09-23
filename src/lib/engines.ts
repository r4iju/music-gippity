// Single source of truth for the LLM engines the wizard can pick from.
// Engine ids are persisted in `llm_token_usage.engine` and
// `user_settings.selected_engine`, so they must stay stable; only the model
// behind each id is expected to rotate.

export const ENGINE_IDS = ["chatgpt", "gemini"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineDefinition {
	label: string;
	provider: "openai" | "google";
	model: string;
}

// Both engines run with reasoning/thinking at its lowest setting: playlist
// curation gains little from deliberation and first-token latency drops from
// ~15-20s to ~1.5s. With reasoning off, GPT-5.x also accepts sampling
// parameters again, so temperature applies to both engines.
export const ENGINES = {
	chatgpt: {
		label: "Chat GPT",
		provider: "openai",
		model: "gpt-5.6-terra",
	},
	gemini: {
		label: "Gemini",
		provider: "google",
		model: "gemini-3.8-flash",
	},
} as const satisfies Record<EngineId, EngineDefinition>;
