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
	/** The row's 1-based place in the tracklist. */
	position: number;
	onDelete: () => void;
	onReplace: () => void;
	editable?: boolean;
};

export default function SongPreview({
	song,
	position,
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
		<div className="group hover:bg-foreground/[0.04] focus-within:bg-foreground/[0.04] grid grid-cols-[2rem_3rem_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-md px-2 py-2 transition-colors">
			{/* Position, swapped for play on hover or focus like a tracklist */}
			<div className="relative flex size-8 items-center justify-center justify-self-center">
				<span
					className={
						trackId
							? "text-muted-foreground text-sm tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 [@media(hover:none)]:opacity-0"
							: "text-muted-foreground text-sm tabular-nums"
					}
				>
					{position}
				</span>
				{trackId && (
					<SpotifyPlayer
						songId={trackId}
						subject={subject}
						className="absolute inset-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
					/>
				)}
			</div>

			<AlbumPreview
				loading={!resolved}
				size={12}
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

			<div className="flex min-w-0 flex-col">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-foreground truncate text-[15px] font-medium leading-6">
						{song.title}
					</span>
					<KnownMarker familiarity={resolved?.familiarity} />
				</div>
				<span className="text-muted-foreground truncate text-sm leading-5">
					{song.artist}
				</span>
				<SongReason reason={resolved?.reason} />
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						disabled={!editable && !trackId}
						className="text-muted-foreground hover:text-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
					>
						<MoreHorizontal className="h-4 w-4" />
						<span className="sr-only">More for {subject}</span>
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
	);
}
