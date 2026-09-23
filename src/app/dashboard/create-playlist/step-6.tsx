import { useState } from "react";
import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { usePlaylist } from "~/contexts/playlist-provider";
import { usePromptBuilder } from "~/contexts/prompt-builder-provider";
import { useOnboarding } from "~/contexts/step-provider";

const CURRENT_STEP = 6;

export default function StepSix() {
	const {
		selectedTrackCount,
		selectedEngine,
		buildPrompt,
		creativity,
		purpose,
	} = usePromptBuilder();
	const { createPlaylist, playlist } = usePlaylist();
	const { prevStep, goToStep, currentStep, totalSteps } = useOnboarding();
	const [finalPrompt, setFinalPrompt] = useState(buildPrompt());
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		createPlaylist({
			prompt: finalPrompt,
			trackCount: selectedTrackCount,
			engine: selectedEngine,
			creativity,
			purpose,
		}).catch((error) => {
			console.error("Error creating playlist", error);
			goToStep(CURRENT_STEP);
		});
	};

	return (
		<CustomDialog
			open={currentStep <= totalSteps}
			onClose={
				playlist?.length > 0 ? () => goToStep(totalSteps + 1) : undefined
			}
		>
			<form onSubmit={handleSubmit} className="flex flex-col gap-y-6">
				<StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
				<DialogHeader>
					<DialogTitle>Customize Prompt</DialogTitle>
					<DialogDescription>
						Feel free to customize the prompt to your liking.
					</DialogDescription>
				</DialogHeader>
				<div className="flex justify-center gap-2">
					<Textarea
						value={finalPrompt}
						rows={6}
						onChange={(e) => setFinalPrompt(e.target.value)}
						className="size-full"
					/>
				</div>
				<div className="flex justify-between">
					<Button type="button" variant="outline" onClick={prevStep}>
						Back
					</Button>
					<Button type="submit" disabled={playlist.isLoading}>
						Go
					</Button>
				</div>
			</form>
		</CustomDialog>
	);
}
