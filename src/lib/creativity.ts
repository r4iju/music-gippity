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
	// Replaces `instruction` under a classics request: the same reach, without
	// a ceiling on widely known tracks or a quota of artists nobody knows.
	classicsInstruction: string;
}

export const CREATIVITY = {
	safe: {
		label: "Safe",
		hint: "Mostly well-known tracks",
		temperature: 0.4,
		instruction:
			"Lean towards recognisable, widely loved tracks; at most a couple of deeper cuts.",
		classicsInstruction:
			"Stay with the most recognisable, widely loved tracks of the brief's scope.",
	},
	balanced: {
		label: "Balanced",
		hint: "Anchors plus deep cuts",
		temperature: 0.8,
		instruction:
			"Mix a few recognisable anchors with deeper cuts, including at least two artists most listeners would not know.",
		classicsInstruction:
			"Mix the most obvious hits with well-known songs a step beyond them, such as fan favourites and the second singles of the brief's scope.",
	},
	adventurous: {
		label: "Adventurous",
		hint: "Mostly discoveries",
		temperature: 1.1,
		instruction:
			"Favour deep cuts, obscure artists, and adjacent scenes; keep at most three widely known tracks as anchors.",
		classicsInstruction:
			"Reach past the most obvious hits to the well-known songs a broad audience would still recognise, including the classics of adjacent scenes.",
	},
} as const satisfies Record<Creativity, CreativityDefinition>;
