import { Button } from "~/components/ui/button";
import { activeRun, type Phase } from "~/lib/generation-run";
import type { GenerationSnapshot } from "~/lib/generation-snapshot";
import type { Generation } from "~/lib/playlist-generation";

const PHASE_LABELS: Record<Phase, string> = {
	queued: "Waiting to start",
	intent: "Reading your brief",
	retrieval: "Finding candidates",
	curation: "Choosing tracks",
	resolution: "Matching recordings",
	checking: "Checking recording evidence",
	repair: "Repairing the playlist",
	rerank: "Setting the listening order",
	finalization: "Verifying the saved playlist",
};

export function GenerationStatus({
	preparation,
	generation,
	run,
	count,
	target,
	onCancel,
	onKeep,
	onRetry,
}: (
	| {
			preparation: "creating" | "loading";
			generation?: never;
			run?: never;
	  }
	| {
			preparation?: undefined;
			generation?: Generation;
			run?: GenerationSnapshot["generation"];
	  }
) & {
	count: number;
	target: number;
	onCancel: () => void;
	onKeep: () => void;
	onRetry: () => void;
}) {
	if (
		!preparation &&
		(run
			? run.state.status === "completed"
			: !generation ||
				generation.status === "idle" ||
				generation.status === "complete")
	)
		return null;
	if (!run && generation?.status === "kept")
		return (
			<p className="text-muted-foreground text-sm">Using your kept tracks.</p>
		);
	const running =
		preparation ||
		(run
			? activeRun(run.state)
			: generation?.status === "running" || generation?.status === "queued");
	const kept = generation?.status === "kept";
	const message =
		run?.state.status === "failed"
			? run.state.failure.message
			: run?.state.status === "cancelled"
				? "Generation was cancelled. Saved recordings are still available."
				: generation?.status === "interrupted"
					? generation.message
					: "";
	return (
		<section
			aria-label="Generation status"
			className="text-foreground space-y-3 rounded-xl bg-primary/8 p-4"
		>
			<div role="status" aria-live="polite">
				<p className="flex items-center gap-2 font-medium">
					{running && (
						<span
							aria-hidden="true"
							className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
						/>
					)}
					{preparation
						? preparation === "creating"
							? "Creating your playlist"
							: "Opening your playlist"
						: running
							? run
								? PHASE_LABELS[run.state.phase]
								: "Building your playlist"
							: run?.state.status === "failed"
								? "Generation failed"
								: run?.state.status === "cancelled"
									? "Generation cancelled"
									: "Playlist needs your attention"}
				</p>
				<p className="text-muted-foreground text-sm">
					{count} of {target} tracks ready.{" "}
					{preparation
						? "Getting everything ready for you."
						: running
							? "Saved as we go. You can leave and come back."
							: message}
				</p>
				{!running && run && (
					<p className="text-muted-foreground text-sm">
						Last phase: {PHASE_LABELS[run.state.phase]}.
					</p>
				)}
				{kept && (
					<p className="text-muted-foreground text-sm">
						Using your kept tracks. You can save or export them; the generation
						outcome is unchanged.
					</p>
				)}
			</div>
			{running && (
				<div
					role="progressbar"
					aria-label="Tracks ready"
					aria-valuemin={0}
					aria-valuemax={target}
					aria-valuenow={Math.min(count, target)}
					className="h-1 overflow-hidden rounded-full bg-primary/10"
				>
					<div
						className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
						style={{
							width: `${target > 0 ? Math.min(100, (count / target) * 100) : 0}%`,
						}}
					/>
				</div>
			)}
			{running ? (
				<Button
					size="sm"
					variant="ghost"
					className="min-h-11 w-full text-muted-foreground"
					onClick={onCancel}
					disabled={Boolean(preparation)}
				>
					Stop generation
				</Button>
			) : (
				<>
					<p className="text-muted-foreground text-sm">
						Generate again starts a new generation; it does not resume this one.
					</p>
					<div className="grid grid-cols-1 gap-2">
						{count > 0 && !kept && (
							<Button size="sm" className="min-h-11 w-full" onClick={onKeep}>
								Keep these tracks
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							className="min-h-11 w-full"
							onClick={onRetry}
						>
							Generate again
						</Button>
					</div>
				</>
			)}
		</section>
	);
}
