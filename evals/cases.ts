import type { Creativity } from "~/lib/creativity";
import type { Purpose } from "~/lib/purpose";

export interface Criterion {
	id: string;
	requirement: string;
}

export interface EvalCase {
	id: string;
	brief: string;
	creativity: Creativity;
	purpose: Purpose;
	trackCount: number;
	trackCriteria: Criterion[];
	playlistCriteria: Criterion[];
}

const industrialBrief =
	"Industrial y EBM para bailar: percusión mecánica, bajos repetitivos y tensión física. Incluye al menos cuatro artistas de la escena española, junto con artistas internacionales. Evita synth-pop suave, baladas y rock industrial dominado por guitarras. Mezcla épocas cuando encaje; no repitas artistas.";

export const CASES: EvalCase[] = [
	...(["safe", "balanced", "adventurous"] as const).map(
		(creativity): EvalCase => ({
			id: `industrial-${creativity}`,
			brief: industrialBrief,
			creativity,
			purpose: "discover",
			trackCount: 15,
			trackCriteria: [
				{
					id: "sound",
					requirement:
						"Industrial/EBM with mechanical percussion, repetitive bass and physical dance energy.",
				},
				{
					id: "exclusions",
					requirement:
						"No soft synth-pop, ballads, or guitar-dominated industrial rock.",
				},
			],
			playlistCriteria: [
				{
					id: "scene",
					requirement:
						"At least four artists from the Spanish scene, alongside international artists from outside that scene. An all-Spanish-scene playlist misses the requested international mix. Spanish-language titles alone do not establish scene membership; identify supporting artists and mark uncertain when unknown.",
				},
			],
		}),
	),
	{
		id: "night-drive",
		brief: "Nocturnal synthwave for a long drive",
		creativity: "balanced",
		purpose: "discover",
		trackCount: 15,
		trackCriteria: [
			{
				id: "sound",
				requirement:
					"Synthwave with a nocturnal driving atmosphere. A slower cruiser can fit; do not impose workout intensity.",
			},
		],
		playlistCriteria: [],
	},
	{
		id: "rainy-bossa",
		brief: "Bossa nova para uma tarde de domingo chuvosa",
		creativity: "balanced",
		purpose: "comfort",
		trackCount: 15,
		trackCriteria: [
			{
				id: "sound",
				requirement:
					"Bossa nova suited to a rainy Sunday afternoon. Portuguese-language music alone is insufficient; vocals are allowed.",
			},
		],
		playlistCriteria: [],
	},
	{
		id: "uk-garage",
		brief: "90s UK garage and 2-step club bangers",
		creativity: "balanced",
		purpose: "room",
		trackCount: 15,
		trackCriteria: [
			{
				id: "sound",
				requirement:
					"UK garage/2-step with club energy, not generic house or later dubstep.",
			},
			{
				id: "era",
				requirement:
					"The requested recording or version originated in 1990–1999. A compilation/reissue date cannot establish the original release year. If unsure, say uncertain.",
			},
		],
		playlistCriteria: [],
	},
	{
		id: "continuous-workout",
		brief:
			"30 tracks of hard-hitting pop and electronic music for continuous vigorous exercise. Every track should sustain a strong driving pulse and high energy. No warm-up or cooldown section, slow cruisers, ballads, ambient intros, or extended quiet breakdowns. Vocals are welcome; do not repeat artists.",
		creativity: "balanced",
		purpose: "discover",
		trackCount: 30,
		trackCriteria: [
			{
				id: "sound",
				requirement: "Pop or electronic music; vocals are welcome.",
			},
			{
				id: "activity",
				requirement:
					"Sustained driving pulse and high energy for vigorous exercise, including the opening and closing tracks. No slow cruisers, ballads, ambient intros or extended quiet breakdowns. Do not invent a BPM threshold.",
			},
		],
		playlistCriteria: [],
	},
	{
		id: "instrumental-study",
		brief:
			"Instrumental electronic music for quiet reading and sustained concentration. Keep a steady, restrained energy: no sung or spoken vocals, vocal samples, sudden loud peaks, festival drops, or abrupt stylistic jumps. A gentle pulse is welcome; this is not a sleep playlist. No repeated artists.",
		creativity: "balanced",
		purpose: "discover",
		trackCount: 15,
		trackCriteria: [
			{
				id: "sound",
				requirement:
					"Instrumental electronic music without sung/spoken vocals or vocal samples. Judge the exact version; if vocal content is unknown, say uncertain.",
			},
			{
				id: "activity",
				requirement:
					"Restrained steady energy for reading, without sudden loud peaks or festival drops. A gentle pulse is allowed; do not require beatless ambient.",
			},
		],
		playlistCriteria: [],
	},
];

export const SHARED_PLAYLIST_CRITERIA: Criterion[] = [
	{
		id: "creativity",
		requirement:
			"Follow the supplied creativity instruction within the brief's constraints. Familiarity is audience-dependent: identify concrete anchors/discoveries, do not equate obscurity with quality or invent popularity measurements.",
	},
	{
		id: "sequence",
		requirement:
			"Listening order should form a coherent progression appropriate to the brief. Do not demand a generic warm-up/peak/cooldown arc when the activity rules exclude one. Mark uncertain when transitions cannot be assessed from known recordings.",
	},
	{
		id: "description",
		requirement:
			"Description is in the brief's language, under 300 characters, and concretely explains a thread supported by the final tracks. Flag empty adjective stacking and unsupported promises. Every artist named as present must actually appear in the final tracklist, allowing spelling aliases. Do not require named artists or a shorter character limit.",
	},
];
