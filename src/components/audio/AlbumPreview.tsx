import { CrossIcon } from "lucide-react";
import Image from "next/image";
import {
	OpenInSpotify,
	type SpotifyEntityKind,
} from "~/components/spotify/open-in-spotify";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type Props = {
	albumImageUrl?: string | null;
	albumTitle?: string | null;
	size?: number;
	loading?: boolean;
	/** Where the artwork links on Spotify; artwork must link back to its item. */
	spotifyLink?: { kind: SpotifyEntityKind; id: string; subject: string };
};

const AlbumPreview = ({
	albumImageUrl,
	albumTitle,
	size,
	loading,
	spotifyLink,
}: Props) => {
	const hasImage = Boolean(albumImageUrl);
	const tooltipText = albumTitle || "Album title unavailable";
	const px = (size || 20) * 4;
	// Artwork stays unmodified; the guidelines only allow rounded corners,
	// 4px at small sizes and 8px when rendered large.
	const radius = px >= 128 ? "rounded-[8px]" : "rounded-[4px]";

	const artwork = hasImage ? (
		<Image
			src={albumImageUrl as string}
			alt={albumTitle || "Album Art"}
			className={cn("block", radius)}
			width={px}
			height={px}
		/>
	) : (
		<div
			className={cn(
				"relative flex items-center justify-center bg-gray-800",
				radius,
			)}
			style={{ width: px, height: px }}
		>
			{!loading && <CrossIcon className="size-1/2" />}
		</div>
	);

	return (
		<div className="group relative flex size-16 justify-center">
			<Tooltip>
				<TooltipTrigger asChild>
					{spotifyLink ? (
						<OpenInSpotify
							{...spotifyLink}
							label="Listen on Spotify"
							className={cn("block", radius)}
						>
							{artwork}
						</OpenInSpotify>
					) : (
						<span className="block">{artwork}</span>
					)}
				</TooltipTrigger>
				<TooltipContent
					className={cn("", {
						"bg-secondary text-secondary-foreground": !albumTitle,
					})}
				>
					{tooltipText}
					{spotifyLink && (
						<span className="block opacity-80">Listen on Spotify</span>
					)}
				</TooltipContent>
			</Tooltip>
		</div>
	);
};

export default AlbumPreview;
