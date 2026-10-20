import type { Assessment } from "./judge";

/** A seeded generator, so a shuffle can be repeated from its seed. */
function mulberry32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The tracks in another order, the same for the same seed. A shuffle that
 * lands on the original order is rotated by one, so the judge always sees
 * a different sequence.
 */
export function shuffleTracks<T>(tracks: readonly T[], seed: number): T[] {
	const random = mulberry32(seed);
	const shuffled = [...tracks];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
	}
	return shuffled.every((track, index) => track === tracks[index])
		? [...shuffled.slice(1), ...shuffled.slice(0, 1)]
		: shuffled;
}

const SENTENCE = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;

/**
 * The description reworded without an engine: its sentences in reverse
 * order, or for a single sentence its comma or semicolon clauses. Every
 * promise survives, so a verdict that changes was swayed by wording and
 * order alone. Null when there is nothing to reorder.
 */
export function paraphraseDescription(description: string): string | null {
	const sentences = (description.trim().match(SENTENCE) ?? [])
		.map((sentence) => sentence.trim())
		.filter(Boolean);
	if (sentences.length > 1) return sentences.reverse().join(" ");
	const clauses = description
		.trim()
		.split(/\s*[,;]\s+/)
		.filter(Boolean);
	return clauses.length > 1 ? clauses.reverse().join(", ") : null;
}

/** Filler that names no sound, era, artist or rule, so it promises nothing. */
const PADDING =
	"Put it on, settle in and let it play. Turn it up or down as the moment needs. Skip anything that does not land and come back to it later; there is no wrong way to listen.";

/** The description with promise-free filler after it. */
export const padDescription = (description: string): string =>
	`${description.trim()} ${PADDING}`;

export type Variant = "shuffled" | "paraphrased" | "padded";

/**
 * The saved run as the judge sees it under each perturbation: tracks
 * shuffled with `seed`, the description paraphrased, the description
 * padded. Each changes one thing; a paraphrase with nothing to reorder is
 * left out.
 */
export function robustnessVariants<
	R extends { songs: readonly unknown[]; description: string },
>(result: R, seed: number): { variant: Variant; result: R }[] {
	const paraphrased = paraphraseDescription(result.description);
	return [
		{
			variant: "shuffled",
			result: { ...result, songs: shuffleTracks(result.songs, seed) },
		},
		...(paraphrased === null
			? []
			: [
					{
						variant: "paraphrased" as const,
						result: { ...result, description: paraphrased },
					},
				]),
		{
			variant: "padded",
			result: { ...result, description: padDescription(result.description) },
		},
	];
}

type Verdict = Assessment["tracks"][number]["verdict"];

interface Judged {
	songs: readonly { artist: string; title: string; songId?: string | null }[];
	assessment: Assessment;
}

/** A verdict that differs between the original and a variant judgment. */
export interface VerdictChange {
	kind: "track" | "criterion";
	/** The track as the curator named it, or the playlist criterion's id. */
	subject: string;
	before: Verdict | "missing";
	after: Verdict | "missing";
	/** The variant judgment's reason. */
	reason: string;
}

const recording = (song: Judged["songs"][number]) =>
	song.songId ?? `${song.artist}/${song.title}`;

/**
 * Verdicts that changed from `baseline` to `variant`, in the baseline's
 * order. Tracks are matched by recording, not position, so a shuffle
 * compares each recording with itself.
 */
export function changedVerdicts(
	baseline: Judged,
	variant: Judged,
): VerdictChange[] {
	const trackVerdicts = ({ songs, assessment }: Judged) =>
		new Map(
			songs.map((song, index) => [
				recording(song),
				assessment.tracks.find((track) => track.position === index + 1),
			]),
		);
	const before = trackVerdicts(baseline);
	const after = trackVerdicts(variant);
	const tracks = baseline.songs.flatMap((song): VerdictChange[] => {
		const was = before.get(recording(song));
		const now = after.get(recording(song));
		if (was?.verdict === now?.verdict) return [];
		return [
			{
				kind: "track",
				subject: `${song.artist} — ${song.title}`,
				before: was?.verdict ?? "missing",
				after: now?.verdict ?? "missing",
				reason: now?.reason ?? "missing",
			},
		];
	});
	const criteria = baseline.assessment.playlist.flatMap(
		(was): VerdictChange[] => {
			const now = variant.assessment.playlist.find(
				(item) => item.criterionId === was.criterionId,
			);
			if (was.verdict === now?.verdict) return [];
			return [
				{
					kind: "criterion",
					subject: was.criterionId,
					before: was.verdict,
					after: now?.verdict ?? "missing",
					reason: now?.reason ?? "missing",
				},
			];
		},
	);
	return [...tracks, ...criteria];
}
