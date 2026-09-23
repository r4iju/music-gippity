// What the playlist is for. It decides how far the playlist may repeat what
// the listener already knows, so it is chosen by the listener rather than
// read from the brief.

export const PURPOSES = ["discover", "room", "comfort"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const DEFAULT_PURPOSE: Purpose = "discover";

/** A stored or received value as a purpose, falling back to the default. */
export const asPurpose = (value: unknown): Purpose =>
	PURPOSES.find((purpose) => purpose === value) ?? DEFAULT_PURPOSE;

export interface PurposeDefinition {
	label: string;
	hint: string;
	/** One sentence for the curator on who the playlist is for. */
	instruction: string;
	/** How rerank should shape the listening order. */
	sequencing: string;
	/** How much the listener may already know; null reports without a cap. */
	novelty: { knownTracks: number; knownArtistShare: number } | null;
}

export const PURPOSE = {
	discover: {
		label: "Discover",
		hint: "New music for me",
		instruction:
			"The listener wants to discover music they do not already know, so favour picks they are unlikely to have heard.",
		sequencing:
			"Keep variety from track to track: alternate textures, tempos and eras so each pick is heard on its own terms.",
		novelty: { knownTracks: 2, knownArtistShare: 1 / 3 },
	},
	room: {
		label: "For a room",
		hint: "Playing for other people",
		instruction:
			"The playlist is played for a room of other people, so it must work for a mixed crowd, not only for the listener.",
		sequencing:
			"Build energy gradually towards a peak and ease off at the end, and avoid jarring drops in energy or tempo between neighbours.",
		novelty: null,
	},
	comfort: {
		label: "Comfort",
		hint: "Familiar listening",
		instruction:
			"The listener wants comfortable, familiar listening, so music close to what they already love is welcome.",
		sequencing:
			"Keep a steady, even flow with no sudden changes in energy or mood.",
		novelty: null,
	},
} as const satisfies Record<Purpose, PurposeDefinition>;
