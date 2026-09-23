import { Loader2, MoreHorizontal, RefreshCcw, Trash } from "lucide-react";
import { useState } from "react";
import AlbumPreview from "~/components/audio/AlbumPreview";
import SpotifyPlayer from "~/components/audio/SpotifyPlayer";
import { OpenInSpotify } from "~/components/spotify/open-in-spotify";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { NotFoundSong, Song } from "~/contexts/playlist-provider";
import { KnownMarker } from "./known-marker";
import { SongReason } from "./song-reason";

type Props = {
	song: Song | NotFoundSong;
	onDelete: () => void;
	onReplace: () => void;
	editable?: boolean;
};

export default function SongPreview({
	song,
	onDelete,
	onReplace,
	editable = true,
}: Props) {
	const [isReplacing, setIsReplacing] = useState(false);
	const resolved = "songId" in song ? song : undefined;
	const trackId = resolved?.songId ?? undefined;
	const albumId = resolved?.spotifyRecording?.albumId;
	const subject = `${song.title} by ${song.artist}`;

	const handleReplace = async () => {
		setIsReplacing(true);
		try {
			await onReplace();
		} finally {
			setIsReplacing(false);
		}
	};

	return (
		<div className="flex w-full items-center gap-4">
			{/* Album Icon */}
			<div>
				<AlbumPreview
					loading={!resolved}
					size={16}
					albumImageUrl={resolved?.albumImage ?? null}
					albumTitle={resolved?.albumTitle ?? null}
					spotifyLink={
						albumId
							? { kind: "album", id: albumId, subject }
							: trackId
								? { kind: "track", id: trackId, subject }
								: undefined
					}
				/>
			</div>

			{/* Song Info */}
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-foreground truncate text-sm font-semibold">
						{song.title}
					</span>
					<KnownMarker familiarity={resolved?.familiarity} />
				</div>
				<span className="text-muted-foreground truncate text-sm">
					{song.artist}
				</span>
				<SongReason reason={resolved?.reason} />
			</div>

			{/* Audio Preview */}
			<SpotifyPlayer songId={trackId ?? null} />

			{/* Ellipsis Menu */}
			<div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							disabled={!editable && !trackId}
						>
							<MoreHorizontal className="h-4 w-4" />
							<span className="sr-only">Open menu</span>
						</Button>
					</DropdownMenuTrigger>

					<DropdownMenuContent align="end">
						{trackId && (
							<DropdownMenuItem asChild>
								<OpenInSpotify
									kind="track"
									id={trackId}
									label="Listen on Spotify"
									subject={subject}
									className="w-full cursor-default rounded-sm text-sm font-normal text-inherit hover:text-inherit"
								/>
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							onClick={(e) => {
								e.preventDefault();
								void handleReplace();
							}}
							disabled={isReplacing || !editable}
						>
							{isReplacing ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<RefreshCcw className="mr-2 h-4 w-4" />
							)}
							Replace
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={onDelete}
							disabled={!editable}
						>
							<Trash className="mr-2 h-4 w-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
