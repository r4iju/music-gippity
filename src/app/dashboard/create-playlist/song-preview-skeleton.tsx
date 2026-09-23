export default function SongPreviewSkeleton() {
	return (
		<div className="flex w-full items-center gap-4">
			{/* Album Icon Skeleton */}
			<div>
				<div className="bg-muted size-16 animate-pulse rounded-md" />
			</div>

			{/* Song Info Skeleton */}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="bg-muted h-6 w-24 animate-pulse rounded" />
				<div className="bg-muted h-4 w-32 animate-pulse rounded" />
			</div>

			{/* Audio Preview Skeleton */}
			<div>
				<div className="bg-muted size-10 animate-pulse rounded-full" />
			</div>

			{/* Menu Skeleton */}
			<div>
				<div className="bg-muted size-10 animate-pulse rounded-full" />
			</div>
		</div>
	);
}
