import type { Familiarity } from "~/lib/playlist-stream";

/** A small marker on a recording the listener already knows. */
export function KnownMarker({
	familiarity,
}: {
	familiarity: Familiarity | undefined;
}) {
	if (familiarity !== "known") return null;
	return (
		<span
			title="In your top tracks, saved tracks, recent plays or an earlier playlist"
			className="border-muted text-muted-foreground shrink-0 rounded-full border px-1.5 text-[10px] leading-4"
		>
			You know this
		</span>
	);
}
