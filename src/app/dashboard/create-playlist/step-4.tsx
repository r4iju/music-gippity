import { useState } from "react";
import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { usePlaylist } from "~/contexts/playlist-provider";
import { usePromptBuilder } from "~/contexts/prompt-builder-provider";
import { useOnboarding } from "~/contexts/step-provider";
import { cn } from "~/lib/utils";

export default function StepFour() {
	const options = [5, 10, 20, 30];

	const { selectedTrackCount, setSelectedTrackCount: _setSelectedTrackCount } =
		usePromptBuilder();
	const { playlist } = usePlaylist();
	const [defaultTrackCount, setDefaultTrackCount] =
		useState(selectedTrackCount);
	const [customTrackCount, setCustomTrackCount] = useState(
		options.find((o) => o === selectedTrackCount) ? "" : selectedTrackCount,
	);

	const { nextStep, prevStep, currentStep, totalSteps, goToStep } =
		useOnboarding();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (defaultTrackCount) {
			_setSelectedTrackCount(defaultTrackCount);
		} else if (customTrackCount) {
			_setSelectedTrackCount(Number(customTrackCount));
		}
		nextStep();
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
					<DialogTitle>Playlist Length</DialogTitle>
					<DialogDescription>
						How long do you want your playlist to be?
					</DialogDescription>
				</DialogHeader>
				<div className="grid grid-cols-4 gap-2 gap-y-4">
					{options.map((option) => (
						<Button
							type="button"
							className="w-full"
							key={option}
							variant={defaultTrackCount === option ? "default" : "outline"}
							onClick={() => {
								setDefaultTrackCount(option);
								setCustomTrackCount("");
							}}
						>
							{option}
						</Button>
					))}
					<Input
						className={cn(
							"focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:placeholder:text-muted col-span-2 h-10 w-full focus-visible:ring-1",
							customTrackCount && "bg-primary text-primary-foreground",
						)}
						onFocus={() => {
							setDefaultTrackCount(0);
						}}
						type="number"
						max={50}
						value={customTrackCount}
						onChange={(e) => {
							setCustomTrackCount(e.target.value);
							setDefaultTrackCount(0);
						}}
						placeholder="Custom"
					/>
				</div>

				<div className="flex justify-between">
					<Button type="button" variant="outline" onClick={prevStep}>
						Back
					</Button>
					<Button type="submit">Next</Button>
				</div>
			</form>
		</CustomDialog>
	);
}
