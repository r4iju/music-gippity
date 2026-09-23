import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { usePlaylist } from "~/contexts/playlist-provider";
import { usePromptBuilder } from "~/contexts/prompt-builder-provider";
import { useOnboarding } from "~/contexts/step-provider";
import {
	CREATIVITY,
	CREATIVITY_LEVELS,
	DEFAULT_CREATIVITY,
} from "~/lib/creativity";
import { ENGINE_IDS, ENGINES } from "~/lib/engines";
import { PURPOSE, PURPOSES } from "~/lib/purpose";

export default function StepFive() {
	const {
		selectedEngine,
		setSelectedEngine,
		creativity,
		setCreativity,
		purpose,
		choosePurpose,
	} = usePromptBuilder();
	const { playlist } = usePlaylist();
	const { nextStep, prevStep, currentStep, totalSteps, goToStep } =
		useOnboarding();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		nextStep();
	};

	return (
		<CustomDialog
			open={currentStep <= totalSteps}
			onClose={
				playlist?.length > 0 ? () => goToStep(totalSteps + 1) : undefined
			}
		>
			<form onSubmit={handleSubmit} className="flex flex-col gap-y-10">
				<StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
				<DialogHeader>
					<DialogTitle>How to build it</DialogTitle>
					<DialogDescription>
						Who the playlist is for, how adventurous it gets, and which engine
						curates it.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-y-3">
					<Label>Purpose</Label>
					<div className="flex justify-center gap-2">
						{PURPOSES.map((id) => (
							<Button
								key={id}
								className="flex h-auto w-full flex-col gap-0.5 py-2"
								type="button"
								variant={purpose === id ? "default" : "outline"}
								onClick={() => choosePurpose(id)}
							>
								{PURPOSE[id].label}
								<span className="text-xs font-normal opacity-80">
									{PURPOSE[id].hint}
								</span>
							</Button>
						))}
					</div>
				</div>
				<div className="flex flex-col gap-y-3">
					<Label htmlFor="engine">Engine</Label>
					<div className="flex justify-center gap-2">
						{ENGINE_IDS.map((id) => (
							<Button
								key={id}
								className="w-full"
								type="button"
								variant={selectedEngine === id ? "default" : "outline"}
								onClick={() => setSelectedEngine(id)}
							>
								{ENGINES[id].label}
							</Button>
						))}
					</div>
				</div>
				<div className="flex flex-col gap-y-3">
					<Label>Creativity</Label>
					<div className="flex justify-center gap-2">
						{CREATIVITY_LEVELS.map((level) => (
							<Button
								key={level}
								className="w-full"
								type="button"
								variant={creativity === level ? "default" : "outline"}
								onClick={() => setCreativity(level)}
							>
								{CREATIVITY[level].label}
							</Button>
						))}
					</div>
					<p className="text-sm text-muted-foreground">
						{(CREATIVITY[creativity] ?? CREATIVITY[DEFAULT_CREATIVITY]).hint}
					</p>
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
