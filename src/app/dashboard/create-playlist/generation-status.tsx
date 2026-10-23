import type { ReactNode } from "react";
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
	notice,
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
	/** Replaces the reassurance line, e.g. with the connection state. */
	notice?: ReactNode;
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
	const progress = `${count} of ${target} tracks ready`;
	if (running)
		return (
			<section aria-label="Generation status" className="flex flex-col gap-2">
				<div className="flex items-center gap-3">
					<div
						role="status"
						aria-live="polite"
						className="flex min-w-0 flex-1 items-baseline gap-x-3"
					>
						<p className="text-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
							<span
								aria-hidden="true"
								className="bg-primary size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
							/>
							<span className="truncate">
								{preparation
									? preparation === "creating"
										? "Creating your playlist"
										: "Opening your playlist"
									: run
										? PHASE_LABELS[run.state.phase]
										: "Building your playlist"}
							</span>
						</p>
						<p className="text-muted-foreground shrink-0 text-xs tabular-nums">
							{progress}
						</p>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className="text-muted-foreground hover:text-foreground h-8 shrink-0 px-2.5 text-xs"
						aria-label="Stop generation"
						onClick={onCancel}
						disabled={Boolean(preparation)}
					>
						Stop
					</Button>
				</div>
				<div
					role="progressbar"
					aria-label="Tracks ready"
					aria-valuemin={0}
					aria-valuemax={target}
					aria-valuenow={Math.min(count, target)}
					className="bg-foreground/10 h-1 overflow-hidden rounded-full"
				>
					<div
						className="bg-primary h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
						style={{
							width: `${target > 0 ? Math.min(100, (count / target) * 100) : 0}%`,
						}}
					/>
				</div>
				{notice ?? (
					<p className="text-muted-foreground text-xs">
						{preparation
							? "Getting everything ready for you."
							: "Saved as we go. You can leave and come back."}
					</p>
				)}
			</section>
		);
	return (
		<section
			aria-label="Generation status"
			className="border-destructive/60 flex flex-col gap-3 border-l-2 py-1 pl-4"
		>
			<div role="status" aria-live="polite" className="flex flex-col gap-1">
				<p className="flex flex-wrap items-baseline gap-x-3">
					<span className="text-foreground text-sm font-medium">
						{run?.state.status === "failed"
							? "Generation failed"
							: run?.state.status === "cancelled"
								? "Generation cancelled"
								: "Playlist needs your attention"}
					</span>
					<span className="text-muted-foreground text-xs tabular-nums">
						{progress}
					</span>
				</p>
				{message && <p className="text-muted-foreground text-sm">{message}</p>}
				{run && (
					<p className="text-muted-foreground text-xs">
						Last phase: {PHASE_LABELS[run.state.phase]}.
					</p>
				)}
				{kept && (
					<p className="text-muted-foreground text-xs">
						Using your kept tracks. You can save or export them; the generation
						outcome is unchanged.
					</p>
				)}
			</div>
			{notice}
			<div className="flex flex-wrap items-center gap-2">
				{count > 0 && !kept && (
					<Button size="sm" onClick={onKeep}>
						Keep these tracks
					</Button>
				)}
				<Button size="sm" variant="outline" onClick={onRetry}>
					Generate again
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Generate again starts a new generation; it does not resume this one.
			</p>
		</section>
	);
}
