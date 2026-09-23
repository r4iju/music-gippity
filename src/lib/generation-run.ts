import { z } from "zod";
import { DraftSchema, type Generation } from "./playlist-generation";

export const PhaseSchema = z.enum([
	"queued",
	"intent",
	"retrieval",
	"curation",
	"resolution",
	"checking",
	"repair",
	"rerank",
	"finalization",
]);
export type Phase = z.infer<typeof PhaseSchema>;
export const ActivePhaseSchema = PhaseSchema.exclude(["queued"]);
export const FailureSchema = z.object({
	code: z.enum(["ambiguous", "unavailable", "timeout", "invalid"]),
	message: z.string(),
});
export const RunStateSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("queued"), phase: z.literal("queued") }),
	z.object({ status: z.literal("running"), phase: ActivePhaseSchema }),
	z.object({
		status: z.literal("completed"),
		phase: z.literal("finalization"),
	}),
	z.object({
		status: z.literal("failed"),
		phase: ActivePhaseSchema,
		failure: FailureSchema,
	}),
	z.object({ status: z.literal("cancelled"), phase: PhaseSchema }),
]);
export type RunState = z.infer<typeof RunStateSchema>;
export const RunSummarySchema = z.object({
	id: z.string().uuid(),
	state: RunStateSchema,
});
export const PlaylistContentsSchema = DraftSchema.omit({
	generation: true,
	remote: true,
});
export type PlaylistContents = z.infer<typeof PlaylistContentsSchema>;
export const activeRun = (state: RunState) =>
	state.status === "queued" || state.status === "running";

/** Compatibility presentation for legacy playlist editors, never persisted as execution state. */
export function presentGeneration(id: string, state: RunState): Generation {
	switch (state.status) {
		case "queued":
			return { status: "queued", runId: id };
		case "running":
			return { status: "running", runId: id };
		case "completed":
			return { status: "complete" };
		case "failed":
			return { status: "interrupted", message: state.failure.message };
		case "cancelled":
			return {
				status: "interrupted",
				message: "Generation cancelled. Your saved tracks are still here.",
			};
	}
}
