"use client";
import { motion } from "motion/react";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import CustomDialog, {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/onboard-dialog";
import StepIndicator from "~/components/step-indicator";
import { Button } from "~/components/ui/button";
import { usePlaylist } from "~/contexts/playlist-provider";
import { useRecommendations } from "~/contexts/use-recommendations";
import { cn } from "~/lib/utils";
import { usePromptBuilder } from "../../../contexts/prompt-builder-provider";
import { useOnboarding } from "../../../contexts/step-provider";

const ArtistSkeleton = () => {
	return (
		<div
			className={`h-10 min-w-20 w-${Math.floor(Math.random() * 14) * 4} bg-muted animate-pulse rounded-md`}
		/>
	);
};

const StepThree = () => {
	const { prevStep, nextStep, currentStep, totalSteps, goToStep } =
		useOnboarding();
	const {
		recommendations,
		loading,
		expectedCount,
		fetchRecommendations,
		setIgnoredArtists,
		setRecommendations,
	} = useRecommendations();
	const { selectedArtists, setSelectedArtists } = usePromptBuilder();
	const { playlist } = usePlaylist();

	const fetchCalledRef = useRef(false);
	useEffect(() => {
		if (recommendations.length === 0 && !fetchCalledRef.current) {
			fetchCalledRef.current = true;
			void fetchRecommendations();
		}
		// We only want to run this effect on mount, so we disable exhaustive-deps.
	}, [fetchRecommendations, recommendations.length]);

	// We expect at least 20 recommendations; if fewer are available while loading,
	// show skeleton placeholders for the remainder.
	const skeletonCount = useMemo(
		() =>
			loading && recommendations.length < expectedCount
				? expectedCount - recommendations.length
				: 0,
		[loading, recommendations.length, expectedCount],
	);

	// Compute a union of recommendations:
	// First, display selected artists (in the order they appear in selectedArtists),
	// then display fetched recommendations that are not selected.
	const unionRecommendations = useMemo(() => {
		return [
			...selectedArtists.map((artist) => ({ value: artist, label: artist })),
			...recommendations.filter((rec) => !selectedArtists.includes(rec.value)),
		];
	}, [selectedArtists, recommendations]);

	const toggleArtist = (value: string) => {
		setSelectedArtists((prev: string[]) => {
			if (prev.includes(value)) {
				const updated = prev.filter((item) => item !== value);
				return updated;
			} else {
				const updated = [...prev, value]; // Prepend new selection to move it to the top.
				return updated;
			}
		});
	};

	const handleResetRecommendations = () => {
		setRecommendations([]);
		setSelectedArtists([]);
		setIgnoredArtists([]);
		void fetchRecommendations();
	};

	const handleFetchMore = () => {
		setIgnoredArtists((prev) => [
			...prev,
			...recommendations
				.filter((rec) => !prev.includes(rec.value))
				.map((rec) => rec.value),
			...selectedArtists.filter((artist) => !prev.includes(artist)),
		]);
		setRecommendations([]);
		void fetchRecommendations();
	};

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
			<form onSubmit={handleSubmit} className="flex flex-col gap-y-6">
				<StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
				<DialogHeader>
					<DialogTitle>Artists?</DialogTitle>
					<DialogDescription className="flex items-center justify-between">
						Any specific artists you want to include?
						<Button
							disabled={loading}
							variant="secondary"
							type="button"
							onClick={handleResetRecommendations}
						>
							Reset
						</Button>
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-y-2">
					{/* Wrap the list in a motion.div with layout enabled */}
					<motion.div className="flex flex-wrap gap-2" layout>
						{unionRecommendations.map((artist) => (
							<motion.div
								key={artist.value}
								layout
								transition={{ type: "spring", stiffness: 400, damping: 40 }}
							>
								<Button
									type="button"
									variant={
										selectedArtists.includes(artist.value)
											? "default"
											: "outline"
									}
									onClick={() => toggleArtist(artist.value)}
									className={cn(
										"max-w-[12rem] min-w-0 truncate text-left capitalize",
										{
											"text-primary-foreground": selectedArtists.includes(
												artist.value,
											),
										},
									)}
								>
									{artist.label}
								</Button>
							</motion.div>
						))}
						{Array.from({ length: skeletonCount }).map((_, index) => (
							<motion.div
								// biome-ignore lint/suspicious/noArrayIndexKey: Skeletons are static
								key={`skeleton-${index}`}
								layout
								transition={{ type: "spring", stiffness: 500, damping: 30 }}
							>
								<ArtistSkeleton />
							</motion.div>
						))}
						{!loading && (
							<Button
								variant="secondary"
								type="button"
								onClick={handleFetchMore}
							>
								See more
							</Button>
						)}
					</motion.div>
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

export default StepThree;
