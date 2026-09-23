import { describe, expect, test } from "bun:test";
import type { Song } from "~/contexts/playlist-provider";
import { artistKey, SlotCaps, takeFromPool } from "~/lib/caps";
import type { Evidence } from "~/lib/evidence";
import { groundIntent, ReadIntentSchema } from "~/lib/intent";
import { UNRESOLVED } from "~/lib/resolution";
import { repairFromEvidence } from "~/server/api/repair";

const song = (
	id: string,
	artist: string,
	title = "Song",
	resolved = true,
): Song => ({
	id,
	order: 1,
	artist,
	title,
	songId: resolved ? `sp-${artist}-${title}` : null,
	resolution: UNRESOLVED,
	...(resolved
		? {
				spotifyRecording: {
					title,
					artists: [artist],
					albumId: `album-${artist}`,
					durationMs: 1000,
				},
			}
		: {}),
});

describe("slot caps ownership", () => {
	test("releasing a slot keeps a key another slot still holds", () => {
		const caps = new SlotCaps(null);
		// A pick whose lookup failed holds its artist's name beside a
		// resolved slot by the same act.
		caps.claim(song("resolved", "Alpha"));
		caps.claim(song("failed", "Alpha", "Other", false));
		caps.release("resolved");
		expect(caps.has(artistKey("Alpha"))).toBe(true);
		expect(caps.conflicts(song("pool-1", "Alpha", "Third"))).toBe(true);
		caps.release("failed");
		expect(caps.has(artistKey("Alpha"))).toBe(false);
	});

	test("a slot holds exactly the keys of the song it shows", () => {
		const caps = new SlotCaps(null);
		caps.claim(song("slot", "Alpha"));
		caps.claim(song("slot", "Bravo"));
		expect(caps.has(artistKey("Alpha"))).toBe(false);
		expect(caps.has("album:album-Alpha")).toBe(false);
		expect(caps.has(artistKey("Bravo"))).toBe(true);
	});

	test("a slot's own keys never conflict with its next take", () => {
		const caps = new SlotCaps(null);
		caps.claim(song("slot", "Alpha"));
		caps.claim(song("other", "Bravo"));
		expect(caps.conflicts(song("slot", "Alpha", "Another"))).toBe(false);
		expect(caps.conflicts(song("slot", "Bravo", "Another"))).toBe(true);
		expect(caps.heldElsewhere(artistKey("Alpha"), "slot")).toBe(false);
		expect(caps.heldElsewhere(artistKey("Alpha"), "other")).toBe(true);
	});

	test("a key held ahead of resolution is freed with its slot", () => {
		const caps = new SlotCaps(null);
		caps.hold(artistKey("Alpha"), "slot");
		expect(caps.heldElsewhere(artistKey("Alpha"), "other")).toBe(true);
		caps.release("slot");
		expect(caps.has(artistKey("Alpha"))).toBe(false);
	});

	test("a claim drops a key held ahead of it that the song lacks", () => {
		const caps = new SlotCaps(null);
		caps.hold(artistKey("Alpha"), "slot");
		caps.claim(song("slot", "Bravo"));
		expect(caps.has(artistKey("Alpha"))).toBe(false);
		expect(caps.has(artistKey("Bravo"))).toBe(true);
	});

	test("a key two slots hold is held elsewhere for both", () => {
		const caps = new SlotCaps(null);
		caps.hold(artistKey("Alpha"), "one");
		caps.hold(artistKey("Alpha"), "two");
		expect(caps.heldElsewhere(artistKey("Alpha"), "one")).toBe(true);
		expect(caps.heldElsewhere(artistKey("Alpha"), "two")).toBe(true);
		caps.release("two");
		expect(caps.heldElsewhere(artistKey("Alpha"), "one")).toBe(false);
	});

	test("random claims, holds and releases keep the holdings consistent", () => {
		// The model: which keys each slot holds. Every query must agree with it.
		let seed = 7;
		const random = (n: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed % n;
		};
		const caps = new SlotCaps(null);
		const model = new Map<string, Set<string>>();
		const slots = ["a", "b", "c", "d"];
		const artists = ["Alpha", "Bravo", "Charlie"];
		for (let step = 0; step < 3000; step++) {
			const slot = slots[random(slots.length)] as string;
			const artist = artists[random(artists.length)] as string;
			const op = random(3);
			if (op === 0) {
				const claimed = song(slot, artist, `T${random(2)}`);
				caps.claim(claimed);
				model.set(slot, new Set(caps.keys(claimed)));
			} else if (op === 1) {
				caps.hold(artistKey(artist), slot);
				model.set(slot, new Set(model.get(slot) ?? []).add(artistKey(artist)));
			} else {
				caps.release(slot);
				model.delete(slot);
			}
			const holders = (key: string) =>
				[...model].filter(([, keys]) => keys.has(key)).map(([id]) => id);
			for (const key of [
				...artists.map(artistKey),
				...artists.map((a) => `album:album-${a}`),
			]) {
				expect(caps.has(key)).toBe(holders(key).length > 0);
				for (const id of slots)
					expect(caps.heldElsewhere(key, id)).toBe(
						holders(key).some((holder) => holder !== id),
					);
			}
			const probe = song(slot, artist, "Probe");
			expect(caps.conflicts(probe)).toBe(
				caps.keys(probe).some((key) => holders(key).some((h) => h !== slot)),
			);
		}
	});

	test("the pool skips recordings any slot holds", () => {
		const caps = new SlotCaps(null);
		caps.claim(song("slot", "Alpha"));
		const pool = [song("pool-1", "Alpha", "Other"), song("pool-2", "Bravo")];
		expect(takeFromPool(pool, caps)?.artist).toBe("Bravo");
		expect(pool.map((s) => s.artist)).toEqual(["Alpha"]);
	});

	describe("repair from evidence", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({
				vocalRule: { rule: "no-vocals", quote: "no vocals" },
			}),
			"Deep focus, no vocals",
		);
		const facts = (instrumental: boolean): Evidence => ({
			firstReleaseYear: null,
			artistCountry: null,
			credits: null,
			instrumental: { value: instrumental, source: "lrclib" },
			tempo: null,
			gain: null,
			version: null,
			tags: null,
			listeners: null,
			sources: {
				musicbrainz: "unknown",
				lrclib: "ok",
				deezer: "unknown",
				lastfm: "unknown",
				listenbrainz: "unknown",
			},
		});
		const repair = (pool: Song[], caps: SlotCaps) =>
			repairFromEvidence({
				intent,
				songs: [{ ...song("slot", "Alpha"), evidence: facts(false) }],
				pool,
				caps,
				evidenceFor: async (s) => facts(s.artist !== "Alpha"),
				emit: () => {},
			});

		test("a violator the pool cannot replace keeps its keys", async () => {
			const caps = new SlotCaps(intent);
			caps.claim(song("slot", "Alpha"));
			const result = await repair([song("pool-1", "Alpha", "Other")], caps);
			expect(result.unfilled.map((s) => s.id)).toEqual(["slot"]);
			expect(caps.conflicts(song("pool-2", "Alpha", "Third"))).toBe(true);
		});

		test("a replacement is held by the slot, not by its pool id", async () => {
			const caps = new SlotCaps(intent);
			caps.claim(song("slot", "Alpha"));
			const result = await repair([song("pool-1", "Bravo")], caps);
			expect(result.replacements.map((s) => s.id)).toEqual(["slot"]);
			expect(caps.has(artistKey("Alpha"))).toBe(false);
			expect(caps.heldElsewhere(artistKey("Bravo"), "slot")).toBe(false);
			expect(caps.heldElsewhere(artistKey("Bravo"), "pool-1")).toBe(true);
		});
	});
});
