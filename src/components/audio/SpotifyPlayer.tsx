import { Loader2, Play } from "lucide-react";
import { useSnackbar } from "~/components/snackbar";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type Props = {
	songId: string;
	/** Names the track for screen readers, e.g. "Spaceman by Hardwell". */
	subject: string;
	className?: string;
};

/** Plays a resolved track on the listener's active Spotify device. */
const SpotifyPlayer = ({ songId, subject, className }: Props) => {
	const snackbar = useSnackbar();
	const { mutate: playTrack, isPending } = api.playlist.playTrack.useMutation({
		onSuccess: () => {
			snackbar.open("Playing on Spotify Device", "success");
		},
		onError: (err) => {
			if (err.message.includes("NO_ACTIVE_DEVICE")) {
				snackbar.open(
					"No active Spotify device found. Please open Spotify on your device.",
					"warning",
				);
			} else {
				snackbar.open(`Failed to play: ${err.message}`, "error");
			}
		},
	});

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => playTrack({ trackIds: [songId] })}
					aria-label={`Play ${subject} on Spotify`}
					disabled={isPending}
					className={cn(
						"text-foreground hover:text-primary focus-visible:ring-ring flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-2",
						className,
					)}
				>
					{isPending ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Play className="size-4 fill-current" />
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent className="bg-secondary text-secondary-foreground">
				Play on Spotify
			</TooltipContent>
		</Tooltip>
	);
};

export default SpotifyPlayer;
