import type { ComponentProps, ReactNode } from "react";
import { type SpotifyEntityKind, spotifyUrl } from "~/lib/spotify-links";
import { cn } from "~/lib/utils";
import { SpotifyIcon } from "./spotify-logo";

export type { SpotifyEntityKind } from "~/lib/spotify-links";

/**
 * The only link texts the design guidelines allow for a link into Spotify
 * ("Linking to Spotify"), so the type forbids anything else.
 */
export type SpotifyLinkLabel =
	| "Open Spotify"
	| "Play on Spotify"
	| "Listen on Spotify";

type Props = Omit<ComponentProps<"a">, "href" | "target" | "rel"> & {
	kind: SpotifyEntityKind;
	id: string;
	label?: SpotifyLinkLabel;
	/** What the link opens, read to assistive tech after the label. */
	subject?: string;
	/** Keep the label for assistive tech only and show just the icon. */
	iconOnly?: boolean;
	/** Custom link body (e.g. artwork); the label then lives in aria-label. */
	children?: ReactNode;
};

/** An accessible link to an item on open.spotify.com, opened in a new tab. */
export function OpenInSpotify({
	kind,
	id,
	label = kind === "artist" ? "Open Spotify" : "Listen on Spotify",
	subject,
	iconOnly = false,
	children,
	className,
	...rest
}: Props) {
	const accessibleName = subject ? `${label}: ${subject}` : label;
	return (
		<a
			href={spotifyUrl(kind, id)}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={accessibleName}
			title={children ? accessibleName : undefined}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-[4px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
				!children &&
					"text-muted-foreground hover:text-foreground text-xs font-medium",
				className,
			)}
			{...rest}
		>
			{children ?? (
				<>
					<SpotifyIcon decorative />
					<span className={cn(iconOnly && "sr-only")}>{label}</span>
				</>
			)}
		</a>
	);
}
