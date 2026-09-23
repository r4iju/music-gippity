import type { Song } from "~/contexts/playlist-provider";
import type { Intent } from "./intent";
import { normalize } from "./resolution";

/** One key per act, so "Kavinsky" and "KAVINSKY " count as the same artist. */
export const artistKey = (artist: string) => `artist:${normalize(artist)}`;

/**
 * Filled slots claim keys so no later slot repeats them: one per artist
 * (the pick's and every credited artist), one per Spotify ID, one per ISRC
 * and one per album. An intent that asks for an album lifts the album cap.
 *
 * Each key records the slots holding it, and a slot holds exactly the keys
 * of the song it shows (nothing, when a pick that found no recording stays
 * visible), so releasing a slot never frees a key another slot still holds
 * and a slot may take another recording by its own act.
 */
export class SlotCaps {
	private readonly holders = new Map<string, Set<string>>();
	private readonly held = new Map<string, Set<string>>();
	private readonly perAlbum: boolean;

	constructor(intent: Intent | null) {
		this.perAlbum = !intent?.album;
	}

	/** Every key the song would claim, given what Spotify resolved. */
	keys(song: Song): string[] {
		const keys = [song.artist, ...(song.spotifyRecording?.artists ?? [])].map(
			artistKey,
		);
		if (song.songId) keys.push(`id:${song.songId}`);
		if (song.resolution?.isrc) keys.push(`isrc:${song.resolution.isrc}`);
		if (this.perAlbum && song.spotifyRecording?.albumId)
			keys.push(`album:${song.spotifyRecording.albumId}`);
		return keys;
	}

	/** True when any slot holds the key. */
	has(key: string): boolean {
		return this.holders.has(key);
	}

	/** True when a slot other than `slot` holds the key. */
	heldElsewhere(key: string, slot: string): boolean {
		const holders = this.holders.get(key);
		return holders !== undefined && (holders.size > 1 || !holders.has(slot));
	}

	/**
	 * True when a slot other than the song's own claimed one of its keys. A
	 * pool song carries its pool id, so every slot counts.
	 */
	conflicts(song: Song): boolean {
		return this.keys(song).some((key) => this.heldElsewhere(key, song.id));
	}

	/** The song's slot now holds exactly the song's keys. */
	claim(song: Song): void {
		this.release(song.id);
		for (const key of this.keys(song)) this.hold(key, song.id);
	}

	/** Add a key to a slot's hold, ahead of the song that will claim it. */
	hold(key: string, slot: string): void {
		const holders = this.holders.get(key) ?? new Set<string>();
		holders.add(slot);
		this.holders.set(key, holders);
		const held = this.held.get(slot) ?? new Set<string>();
		held.add(key);
		this.held.set(slot, held);
	}

	/** Free the keys the slot holds; those other slots hold too stay claimed. */
	release(slot: string): void {
		for (const key of this.held.get(slot) ?? []) {
			const holders = this.holders.get(key);
			holders?.delete(slot);
			if (holders?.size === 0) this.holders.delete(key);
		}
		this.held.delete(slot);
	}
}

/** The first pool recording that passes the caps and `accepts`, removed from the pool. */
export function takeFromPool<S extends Song>(
	pool: S[],
	caps: SlotCaps,
	accepts: (song: S) => boolean = () => true,
): S | null {
	const index = pool.findIndex(
		(song) => !caps.conflicts(song) && accepts(song),
	);
	if (index === -1) return null;
	return pool.splice(index, 1)[0] ?? null;
}
