import { z } from "zod";
import { ReplaceSongSchema } from "~/app/dashboard/create-playlist/playlist-form-schema";
import { EvidenceSchema } from "~/lib/evidence";
import { SongSchema } from "~/lib/playlist-stream";

const ReplacementSchema = SongSchema.extend({
	evidence: EvidenceSchema.optional(),
	reason: z.string().optional(),
});
export async function replaceRecording(
	input: z.input<typeof ReplaceSongSchema>,
) {
	const response = await fetch("/api/edge/replace-song", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(ReplaceSongSchema.parse(input)),
	});
	if (!response.ok) throw new Error("Failed to replace song");
	return ReplacementSchema.parse(await response.json());
}
