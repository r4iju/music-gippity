"use client";

import type React from "react";
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
import { usePromptBuilder } from "../../../contexts/prompt-builder-provider";
import { useOnboarding } from "../../../contexts/step-provider";

// Broad starting points; the custom field covers the long tail, where the
// candidate sources (Last.fm charts, MusicBrainz tags) are most specific.
const presetGenres = [
	"Pop",
	"Rock",
	"Hip-Hop",
	"R&B",
	"Soul",
	"Electronic",
	"House",
	"Techno",
	"Ambient",
	"Lo-fi",
	"Indie",
	"Metal",
	"Punk",
	"Folk",
	"Country",
	"Blues",
	"Jazz",
	"Classical",
	"Latin",
	"Reggae",
];

const StepTwo = () => {
	const { nextStep, prevStep, currentStep, totalSteps, goToStep } =
		useOnboarding();
	// An empty selection means any genre: the prompt leaves genre out.
	const { selectedGenres, setSelectedGenres } = usePromptBuilder();
	const { playlist } = usePlaylist();
	const [customGenre, setCustomGenre] = useState("");

	const customGenres = selectedGenres.filter((g) => !presetGenres.includes(g));

	const toggleGenre = (genre: string) => {
		setSelectedGenres((prev) =>
			prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
		);
	};

	const addCustomGenres = () => {
		const typed = customGenre
			.split(",")
			.map((g) => g.trim())
			.filter(Boolean)
			.map(
				(g) =>
					presetGenres.find((p) => p.toLowerCase() === g.toLowerCase()) ?? g,
			);
		setSelectedGenres((prev) => {
			const known = new Set(prev.map((g) => g.toLowerCase()));
			const added = typed.filter((g) => {
				const key = g.toLowerCase();
				if (known.has(key)) return false;
				known.add(key);
				return true;
			});
			return [...prev, ...added];
		});
		setCustomGenre("");
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		// Text left in the field was meant as a genre, not discarded.
		if (customGenre.trim()) addCustomGenres();
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
						<DialogTitle>Any Genres in Mind?</DialogTitle>
						<DialogDescription>
							Pick as many as you like, add your own, or leave it open.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant={selectedGenres.length === 0 ? "default" : "outline"}
							aria-pressed={selectedGenres.length === 0}
							onClick={() => setSelectedGenres([])}
						>
							Any genre
						</Button>
						{[...presetGenres, ...customGenres].map((genre) => (
							<Button
								key={genre}
								type="button"
								variant={selectedGenres.includes(genre) ? "default" : "outline"}
								aria-pressed={selectedGenres.includes(genre)}
								onClick={() => toggleGenre(genre)}
								className="max-w-[12rem] min-w-0 truncate"
							>
								{genre}
							</Button>
						))}
					</div>
					<div className="flex gap-2">
						<Input
							type="text"
							aria-label="Add a genre"
							value={customGenre}
							onChange={(e) => setCustomGenre(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addCustomGenres();
								}
							}}
							placeholder="Something else? e.g. shoegaze, city pop"
						/>
						<Button
							type="button"
							variant="secondary"
							disabled={!customGenre.trim()}
							onClick={addCustomGenres}
						>
							Add
						</Button>
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
