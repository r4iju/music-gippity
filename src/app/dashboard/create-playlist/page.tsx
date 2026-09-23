import type { Metadata } from "next";
import { RecommendationsProvider } from "~/contexts/use-recommendations";
import { PromptBuilderProvider } from "../../../contexts/prompt-builder-provider";
import { OnboardingProvider } from "../../../contexts/step-provider";
import { StepWrapper } from "./steps-wrapper";

export const metadata: Metadata = {
	title: "Playlists",
	description: "Playlists | Create a playlist with AI | Music Gippity",
};

export default function CreatePlaylist() {
	return (
		<div className="container mx-auto">
			<div className="flex flex-col items-center justify-center gap-1 px-4 sm:px-6">
				<OnboardingProvider>
					<PromptBuilderProvider>
						<RecommendationsProvider>
							<StepWrapper />
						</RecommendationsProvider>
					</PromptBuilderProvider>
				</OnboardingProvider>
			</div>
		</div>
	);
}
