import { Loader2, PlayCircle, VolumeOff } from "lucide-react";
import { useSnackbar } from "~/components/snackbar";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type Props = {
	songId?: string | null;
};

const SpotifyPlayer = ({ songId }: Props) => {
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

	let IconComponent = isPending ? Loader2 : PlayCircle;
	let tooltipText = "Play on Spotify";
	let buttonClass =
		"group flex items-center justify-center rounded-full focus:outline-hidden focus:ring-2";

	if (!songId) {
		IconComponent = VolumeOff;
		tooltipText = "Audio unavailable";
		buttonClass += " bg-gray-200 text-gray-500 cursor-not-allowed";
	}

	return (
		<div className="group relative flex justify-center">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="default"
						size="icon"
						onClick={() => songId && playTrack({ trackIds: [songId] })}
						className={buttonClass}
						aria-label={tooltipText}
						disabled={isPending || !songId}
					>
						<IconComponent
							className={cn("size-8 ", {
								"animate-spin": isPending,
							})}
						/>
					</Button>
				</TooltipTrigger>
				<TooltipContent className="bg-secondary text-secondary-foreground">
					{tooltipText}
				</TooltipContent>
			</Tooltip>
		</div>
	);
};

export default SpotifyPlayer;
