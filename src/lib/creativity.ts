// The wizard's creativity setting. It replaces the raw temperature slider:
// it changes the brief the model receives and picks a sampling temperature
// that both engines accept.

export const CREATIVITY_LEVELS = ["safe", "balanced", "adventurous"] as const;
export type Creativity = (typeof CREATIVITY_LEVELS)[number];

export const DEFAULT_CREATIVITY: Creativity = "balanced";

export interface CreativityDefinition {
	label: string;
	hint: string;
	temperature: number;
	// Appended to the brief; tells the curator how far from the obvious to go.
	instruction: string;
}

export const CREATIVITY = {
	safe: {
		label: "Safe",
		hint: "Mostly well-known tracks",
		temperature: 0.4,
		instruction:
			"Lean towards recognisable, widely loved tracks; at most a couple of deeper cuts.",
	},
	balanced: {
		label: "Balanced",
		hint: "Anchors plus deep cuts",
		temperature: 0.8,
		instruction:
			"Mix a few recognisable anchors with deeper cuts, including at least two artists most listeners would not know.",
	},
	adventurous: {
		label: "Adventurous",
		hint: "Mostly discoveries",
		temperature: 1.1,
		instruction:
			"Favour deep cuts, obscure artists, and adjacent scenes; keep at most three widely known tracks as anchors.",
	},
} as const satisfies Record<Creativity, CreativityDefinition>;
