import { expect, test } from "bun:test";
import type { ArtistCandidate, TrackCandidate } from "~/lib/playlist-stream";
import { matchPicks, pickDonor, swapPool } from "../evals/candidate-swap";

const artist = (name: string): ArtistCandidate => ({
	name,
	mbid: null,
	source: "tag",
	area: null,
	tags: [],
	label: null,
});
const chart = (name: string, title = "Hit"): TrackCandidate => ({
	artist: name,
	title,
	source: "chart",
	tag: "synthwave",
	listeners: null,
});
const pool = (artists: string[], tracks: string[] = []) => ({
	artists: artists.map(artist),
	tracks: tracks.map((name) => chart(name)),
});

test("picks count against the real pool, the swapped pool, both or neither", () => {
	const real = pool(["Kavinsky"], ["Ulrich"]);
	const swapped = pool(["Esplendor Geométrico", "Ulrich"]);
	const songs = [
		{ artist: "kavinsky", title: "Nightcall" },
		{ artist: "Esplendor Geometrico", title: "Moscu Esta Helado" },
		{ artist: "Ulrich", title: "Sunset" },
		{ artist: "The Midnight", title: "Sunset" },
		// A credited artist on the resolved recording counts as well.
		{
			artist: "Lovefoxxx",
			title: "Nightcall (Live)",
			spotifyRecording: { artists: ["Lovefoxxx", "Kavinsky"] },
		},
	];
	expect(matchPicks(songs, real, swapped)).toEqual({
		total: 5,
		real: 2,
		swapped: 1,
		both: 1,
		neither: 1,
	});
});

test("the swapped pool replaces what the curator is offered and what the run records", () => {
	const found = {
		...pool(["Kavinsky"], ["Ulrich"]),
		event: {
			kind: "candidates",
			status: "ok",
			artists: [artist("Kavinsky")],
			tracks: [chart("Ulrich")],
			totalMs: 10,
		},
	};
	const donor = pool(["Nitzer Ebb"], ["DAF"]);
	// biome-ignore lint/suspicious/noExplicitAny: a partial event stands in for the full one.
	const swapped = swapPool(found as any, donor);
	expect(swapped.artists).toEqual(donor.artists);
	expect(swapped.tracks).toEqual(donor.tracks);
	expect(swapped.event).toMatchObject({
		status: "ok",
		totalMs: 10,
		artists: donor.artists,
		tracks: donor.tracks,
	});
});

test("the donor is another brief's pool sharing the fewest artists", () => {
	const target = { brief: "night drive", candidates: pool(["Kavinsky"]) };
	const others = [
		target,
		// The same brief at another creativity is not unrelated.
		{ brief: "night drive", candidates: pool(["Nitzer Ebb"]) },
		{ brief: "retro", candidates: pool(["Kavinsky", "Nitzer Ebb"]) },
		{ brief: "empty", candidates: pool([]) },
		{ brief: "industrial", candidates: pool(["Nitzer Ebb"], ["DAF"]) },
		{ brief: "bossa", candidates: undefined },
	];
	expect(pickDonor(target, others)?.brief).toBe("industrial");
	expect(pickDonor(target, [target])).toBeUndefined();
});
