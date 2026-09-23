import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Listener } from "~/server/api/listener";

const RecordingSchema = z.object({
	id: z.string().nullable(),
	isrc: z.string().nullable(),
	artists: z.array(z.string()),
});

/** A listener's account as `bun run eval:snapshot-listener` froze it. */
export const SnapshotSchema = z.object({
	takenAt: z.string(),
	savedTracks: z.array(RecordingSchema),
	topTracks: z.array(RecordingSchema),
	recentTracks: z.array(RecordingSchema),
});
export type ListenerSnapshot = z.infer<typeof SnapshotSchema>;

export const SNAPSHOT_PATH = path.join(import.meta.dir, "listener.json");

/** A listener whose account never changes, so runs stay comparable. */
export const fixtureListener = (snapshot: ListenerSnapshot): Listener => ({
	savedTracks: async () => snapshot.savedTracks,
	topTracks: async () => snapshot.topTracks,
	recentTracks: async () => snapshot.recentTracks,
});

/**
 * The committed snapshot as a listener. A missing snapshot fails the run:
 * without one the known and budget columns read as errors, as they did
 * under a client-credentials token.
 */
export async function loadListener(file = SNAPSHOT_PATH): Promise<Listener> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		throw new Error(
			`No listener snapshot at ${file}; run \`bun run eval:snapshot-listener\``,
		);
	}
	return fixtureListener(SnapshotSchema.parse(JSON.parse(raw)));
}
