import { Loader2, PauseCircle, PlayCircle, VolumeOff } from "lucide-react";
import type { ComponentType } from "react";
import { useAudio } from "~/contexts/audio-provider";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type Props = {
	audioUrl: string | null;
};

const PlayAudio = ({ audioUrl }: Props) => {
	const { isPlaying, isLoading, isError, togglePlay } = useAudio(audioUrl);

	let IconComponent: ComponentType<{ className?: string }>;
	let tooltipText = "";
	let buttonClasses =
		"group flex h-10 w-10 items-center justify-center rounded-full focus:outline-hidden focus:ring-3 focus:ring-blue-300";

	if (!audioUrl || isError) {
		IconComponent = VolumeOff;
		tooltipText = "Audio unavailable";
		buttonClasses += " bg-gray-200 text-gray-500";
	} else if (isLoading) {
		IconComponent = Loader2;
		tooltipText = "Loading...";
		buttonClasses += " bg-blue-500 text-white hover:bg-blue-600";
	} else if (isPlaying) {
		IconComponent = PauseCircle;
		tooltipText = "Pause";
		buttonClasses += " bg-blue-500 text-white hover:bg-blue-600";
	} else {
		IconComponent = PlayCircle;
		tooltipText = "Play";
		buttonClasses += " bg-blue-500 text-white hover:bg-blue-600";
	}

	return (
		<div className="group relative flex justify-center">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						onClick={audioUrl && !isError ? togglePlay : undefined}
						className={buttonClasses}
						aria-label={tooltipText}
						disabled={!audioUrl || isError}
					>
						<IconComponent
							className={`size-6 ${isLoading ? "animate-spin" : ""}`}
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

export default PlayAudio;
