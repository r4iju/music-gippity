import { describe, expect, test } from "bun:test";
import type { Song } from "~/contexts/playlist-provider";
import { artistKey, SlotCaps } from "~/lib/caps";
import { repairVocalTracks } from "~/server/api/vocal-repair";
import {
	artistOf,
	geminiStream,
	installFakeFetch,
	openaiStream,
	spotifyTracks,
	titleOf,
} from "./fake-providers";
import { tokenUsageInserts } from "./setup";

const BRIEF = "Electronic music for reading. No vocals.";

const song = (artist: string, order: number): Song => ({
	id: `slot-${artist}`,
	order,
	artist,
	title: "Song",
	songId: `id-${artist}`,
	spotifyRecording: {
		title: "Song",
		artists: [artist],
		albumId: `album-${artist}`,
	} as Song["spotifyRecording"],
	resolution: { tier: "exact", isrc: `ISRC-${artist}` } as Song["resolution"],
});

/** Every original is vocal; `replacements` maps an original's artist to its substitute. */
const install = (
	replacements: Record<string, string>,
	verdict: (artist: string) => "instrumental" | "vocals",
	albumOf: (artist: string) => string = () => "album-compilation",
) =>
	installFakeFetch({
		gemini: (prompt) => {
			const input = JSON.parse(prompt) as {
				tracks: { id: string; artist: string }[];
			};
			return geminiStream(
				JSON.stringify({
					restriction: "No vocals",
					tracks: input.tracks.map((t) => ({
						id: t.id,
						verdict: "vocals",
						reason: "Sung.",
						...(replacements[t.artist]
							? {
									replacement: {
										artist: replacements[t.artist],
										title: "Song",
									},
								}
							: {}),
					})),
				}),
			);
		},
		openai: (prompt) => {
			const input = JSON.parse(prompt) as {
				tracks: { id: string; artist: string }[];
			};
			return openaiStream(
				JSON.stringify({
					restriction: "No vocals",
					tracks: input.tracks.map((t) => ({
						id: t.id,
						verdict: verdict(t.artist),
						reason: "Checked.",
						briefFit: "fit",
					})),
				}),
			);
		},
		spotify: (query) =>
			spotifyTracks([
				{
					id: `id-${artistOf(query)}`,
					name: titleOf(query),
					artist: artistOf(query),
					albumId: albumOf(artistOf(query)),
				},
			]),
	});

describe("vocal repair caps", () => {
	test("a second substitute from an album already taken is refused", async () => {
		tokenUsageInserts.length = 0;
		install({ Alpha: "Xray", Bravo: "Yankee" }, () => "instrumental");
		const songs = [song("Alpha", 1), song("Bravo", 2)];
		const caps = new SlotCaps(null);
		for (const s of songs) caps.claim(s);
		const outcomes: string[] = [];
		const accepted = await repairVocalTracks({
			brief: BRIEF,
			intent: null,
			songs,
			caps,
			token: "t",
			emit: (event) => {
				if (event.kind === "vocal-repair") outcomes.push(event.outcome);
			},
		});
		expect(accepted.map((s) => s.artist)).toEqual(["Xray"]);
		expect(outcomes).toEqual(["duplicate-album", "accepted"]);
		// The review and its verification pass each record their usage.
		expect(tokenUsageInserts.map((row) => row.engine)).toEqual([
			"gemini",
			"chatgpt",
		]);
		expect(caps.has("album:album-compilation")).toBe(true);
		expect(caps.has("album:album-Alpha")).toBe(false);
		expect(caps.has("album:album-Bravo")).toBe(true);
	});

	test("a substitute verification rejects hands the slot's caps back", async () => {
		install({ Alpha: "Xray" }, () => "vocals");
		const songs = [song("Alpha", 1)];
		const caps = new SlotCaps(null);
		for (const s of songs) caps.claim(s);
		const accepted = await repairVocalTracks({
			brief: BRIEF,
			intent: null,
			songs,
			caps,
			token: "t",
			emit: () => {},
		});
		expect(accepted).toEqual([]);
		expect(caps.keys(songs[0] as Song).every((key) => caps.has(key))).toBe(
			true,
		);
		expect(caps.has(artistKey("Xray"))).toBe(false);
	});

	const run = async (songs: Song[]) => {
		const caps = new SlotCaps(null);
		for (const s of songs) caps.claim(s);
		const outcomes: string[] = [];
		const accepted = await repairVocalTracks({
			brief: BRIEF,
			intent: null,
			songs,
			caps,
			token: "t",
			emit: (event) => {
				if (event.kind === "vocal-repair") outcomes.push(event.outcome);
			},
		});
		return { caps, outcomes, accepted };
	};

	test("a substitute may not take keys of another original that could stay", async () => {
		// Yankee sits on Alpha's album; Alpha stays once Xray is rejected.
		install(
			{ Alpha: "Xray", Bravo: "Yankee" },
			(artist) => (artist === "Xray" ? "vocals" : "instrumental"),
			(artist) => (artist === "Yankee" ? "album-Alpha" : `album-${artist}`),
		);
		const { caps, outcomes, accepted } = await run([
			song("Alpha", 1),
			song("Bravo", 2),
		]);
		expect(outcomes).toEqual(["duplicate-album", "not-instrumental"]);
		expect(accepted).toEqual([]);
		for (const artist of ["Alpha", "Bravo"])
			expect(caps.keys(song(artist, 1)).every((key) => caps.has(key))).toBe(
				true,
			);
	});

	test("a substitute by the slot's own act passes and takes over its keys", async () => {
		install(
			{ Alpha: "Alpha" },
			() => "instrumental",
			() => "album-Alpha",
		);
		const { caps, outcomes, accepted } = await run([song("Alpha", 1)]);
		expect(outcomes).toEqual(["accepted"]);
		expect(accepted.map((s) => s.artist)).toEqual(["Alpha"]);
		expect(caps.has(artistKey("Alpha"))).toBe(true);
		expect(caps.has("album:album-Alpha")).toBe(true);
	});
});
