import { z } from "zod";
import { RunSummarySchema } from "~/lib/generation-run";
import {
	DraftSchema,
	type Generation,
	GenerationSchema,
} from "~/lib/playlist-generation";

export const GenerationSnapshotSchema = z.object({
	generation: RunSummarySchema.optional(),
	playlist: DraftSchema,
	revision: z.number().int().min(0),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type GenerationSnapshot = z.infer<typeof GenerationSnapshotSchema>;
export const GenerationSummarySchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	prompt: z.string(),
	status: z.union(
		GenerationSchema.options.map((option) => option.shape.status),
	),
	createdAt: z.number(),
});
export const isGenerating = (status: Generation["status"]) =>
	status === "queued" || status === "running";
