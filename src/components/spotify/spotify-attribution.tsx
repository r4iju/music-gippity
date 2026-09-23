import { cn } from "~/lib/utils";
import { SpotifyLogo } from "./spotify-logo";

/**
 * Attribution required wherever Spotify metadata or artwork is shown
 * (Developer Policy II.4); once per list, with the full logo.
 */
export function SpotifyAttribution({ className }: { className?: string }) {
	return (
		<p
			className={cn(
				"text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
				className,
			)}
		>
			<span>Music data and artwork from Spotify</span>
			<a
				href="https://open.spotify.com"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Open Spotify"
				className="inline-flex rounded-[4px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
			>
				<SpotifyLogo decorative />
			</a>
		</p>
	);
}
