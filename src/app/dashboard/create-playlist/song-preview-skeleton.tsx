/** A track row still on its way; mirrors SongPreview's columns. */
export default function SongPreviewSkeleton({
	position,
}: {
	position: number;
}) {
	return (
		<div
			aria-hidden="true"
			className="grid grid-cols-[2rem_3rem_minmax(0,1fr)_2.5rem] items-center gap-3 px-2 py-2"
		>
			<span className="text-muted-foreground/40 text-center text-sm tabular-nums">
				{position}
			</span>
			<div className="bg-muted/60 size-12 rounded-[4px] motion-safe:animate-pulse" />
			<div className="flex flex-col gap-2">
				<div className="bg-muted/60 h-3.5 w-2/5 rounded-full motion-safe:animate-pulse" />
				<div className="bg-muted/40 h-3 w-1/4 rounded-full motion-safe:animate-pulse" />
			</div>
		</div>
	);
}
