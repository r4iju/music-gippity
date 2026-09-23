import Image from "next/image";
import { cn } from "~/lib/utils";

// Official assets from https://developer.spotify.com/documentation/design
// ("Using our logo"). Spotify green may only sit on pure black or white, so
// the monochrome logo follows the theme: black on light, white on dark.
const FULL_LOGO = {
	black: "/assets/spotify/full-logo-black.svg",
	white: "/assets/spotify/full-logo-white.svg",
};
const ICON = {
	black: "/assets/spotify/icon-black.svg",
	white: "/assets/spotify/icon-white.svg",
};

/** Digital minimums from the guidelines; smaller renders are not compliant. */
export const SPOTIFY_LOGO_MIN_WIDTH = 70;
export const SPOTIFY_ICON_MIN_WIDTH = 21;

const FULL_LOGO_ASPECT = 823.46 / 225.25;
const ICON_ASPECT = 236.05 / 225.25;

type MarkProps = {
	/** Rendered width in CSS pixels; clamped to the guideline minimum. */
	width?: number;
	/** Hide from assistive tech when adjacent text already says "Spotify". */
	decorative?: boolean;
	className?: string;
};

function ThemedMark({
	sources,
	aspect,
	width,
	decorative,
	className,
}: MarkProps & {
	sources: { black: string; white: string };
	aspect: number;
	width: number;
}) {
	const height = Math.round(width / aspect);
	const alt = decorative ? "" : "Spotify";
	return (
		<span
			className={cn("inline-flex shrink-0 select-none", className)}
			style={{ width, height }}
		>
			<Image
				src={sources.black}
				alt={alt}
				width={width}
				height={height}
				className="dark:hidden"
				draggable={false}
			/>
			<Image
				src={sources.white}
				alt={alt}
				width={width}
				height={height}
				className="hidden dark:block"
				draggable={false}
			/>
		</span>
	);
}

/** The full Spotify logo (icon + wordmark), the form required for attribution. */
export function SpotifyLogo({
	width = SPOTIFY_LOGO_MIN_WIDTH,
	...props
}: MarkProps) {
	return (
		<ThemedMark
			sources={FULL_LOGO}
			aspect={FULL_LOGO_ASPECT}
			width={Math.max(width, SPOTIFY_LOGO_MIN_WIDTH)}
			{...props}
		/>
	);
}

/** The Spotify icon alone; only for spots too small for the full logo. */
export function SpotifyIcon({
	width = SPOTIFY_ICON_MIN_WIDTH,
	...props
}: MarkProps) {
	return (
		<ThemedMark
			sources={ICON}
			aspect={ICON_ASPECT}
			width={Math.max(width, SPOTIFY_ICON_MIN_WIDTH)}
			{...props}
		/>
	);
}
