"use client";

import type React from "react";
import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { usePlaylist } from "~/contexts/playlist-provider";
import { cn } from "~/lib/utils";
import { usePromptBuilder } from "../../../contexts/prompt-builder-provider";
import { useOnboarding } from "../../../contexts/step-provider";

const availableGenres = [
	"Pop",
	"Rock",
	"Hip-Hop",
	"Jazz",
	"Classical",
	"Electronic",
	"Country",
	"Indie",
];

const StepTwo = () => {
	const { nextStep, prevStep, currentStep, totalSteps, goToStep } =
		useOnboarding();
	const { selectedGenres, setSelectedGenres } = usePromptBuilder();
	const { playlist } = usePlaylist();

	const toggleGenre = (genre: string) => {
		setSelectedGenres((prev) => {
			if (prev.includes(genre)) {
				return prev.filter((g) => g !== genre);
			} else {
				return [...prev, genre];
			}
		});
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (selectedGenres.length === 0) {
			alert("Please select at least one genre.");
			return;
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
				<div className="flex flex-col gap-y-6">
					<DialogHeader>
						<DialogTitle>Select Your Preferred Genres</DialogTitle>
						<DialogDescription>
							Select your favorite genres to personalize your playlist.
						</DialogDescription>
					</DialogHeader>
					<div className="grid grid-cols-2 gap-2">
						{availableGenres.map((genre) => (
							<Button
								key={genre}
								type="button"
								variant={selectedGenres.includes(genre) ? "default" : "outline"}
								onClick={() => toggleGenre(genre)}
								className={cn("capitalize")}
							>
								{genre}
							</Button>
						))}
					</div>
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
};

export default StepTwo;
