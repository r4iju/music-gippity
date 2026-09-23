"use client";

import type React from "react";
import { useEffect, useState } from "react";
import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { usePlaylist } from "~/contexts/playlist-provider";
import { cn } from "~/lib/utils";
import { usePromptBuilder } from "../../../contexts/prompt-builder-provider";
import { useOnboarding } from "../../../contexts/step-provider";

const moodOptions = [
	"Workout",
	"Relaxation",
	"Party",
	"Study",
	"Chill",
	"Other",
];

const StepOne = () => {
	const { selectedMood, setSelectedMood } = usePromptBuilder();
	const { nextStep, currentStep, totalSteps, goToStep } = useOnboarding();
	const [presetMood, setPresetMood] = useState("");
	const [customMood, setCustomMood] = useState("");
	const { playlist } = usePlaylist();

	// If there is already a persisted mood, pre-populate the local state
	useEffect(() => {
		if (selectedMood) {
			// If the persisted mood is one of the preset options, assign it accordingly.
			if (moodOptions.includes(selectedMood)) {
				setPresetMood(selectedMood);
			} else {
				setCustomMood(selectedMood);
			}
		}
	}, [selectedMood]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const finalMood = customMood || presetMood;
		if (!finalMood) {
			alert("Please select or enter a mood.");
			return;
		}
		setSelectedMood(finalMood);
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
					<DialogTitle>Choose Your Mood</DialogTitle>
					<DialogDescription id="step-1-dialog" className="sr-only">
						Select a mood that reflects your current state. If you choose
						&quot;Other&quot;, please provide a custom mood.
					</DialogDescription>
				</DialogHeader>

				<p className="text-foreground">Select one of the options below:</p>
				<div className="flex flex-wrap gap-2">
					{moodOptions
						.filter((mood) => mood !== "Other")
						.map((mood) => (
							<Button
								key={mood}
								type="button"
								variant={presetMood === mood ? "default" : "outline"}
								onClick={() => {
									setPresetMood(mood);
									setCustomMood("");
								}}
								className={cn("capitalize")}
							>
								{mood}
							</Button>
						))}
					<Input
						type="text"
						id="customMood"
						value={customMood}
						onFocus={() => setPresetMood("")}
						onChange={(e) => setCustomMood(e.target.value)}
						placeholder="Custom mood"
						className="w-auto shrink-0"
					/>
				</div>
				<Button className="w-fit self-end" type="submit">
					Next
				</Button>
			</form>
		</CustomDialog>
	);
};

export default StepOne;
