"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext } from "react";
import { z } from "zod";

const StepSchema = z.coerce
	.number()
	.int()
	.transform((step) => Math.min(7, Math.max(1, step)))
	.catch(1);

type OnboardingContextProps = {
	currentStep: number;
	totalSteps: number;
	nextStep: () => void;
	prevStep: () => void;
	goToStep: (step: number) => void;
	resetStep: () => void;
};

// Create the context with an undefined default value
const OnboardingContext = createContext<OnboardingContextProps | undefined>(
	undefined,
);

type OnboardingProviderProps = {
	children: ReactNode;
};

export const OnboardingProvider = ({ children }: OnboardingProviderProps) => {
	const params = useSearchParams();
	const pathname = usePathname();
	const currentStep = StepSchema.parse(
		params.get("currentStep") ??
			(pathname.startsWith("/dashboard/playlists/") ? 7 : 1),
	);
	const goToStep = (step: number) => {
		const url = new URL(window.location.href);
		if (step <= 6) url.pathname = "/dashboard/create-playlist";
		url.searchParams.set("currentStep", String(Math.min(7, Math.max(1, step))));
		window.history.replaceState(null, "", url);
	};
	const nextStep = () => goToStep(currentStep + 1);
	const prevStep = () => goToStep(currentStep - 1);
	const resetStep = () => goToStep(1);

	return (
		<OnboardingContext.Provider
			value={{
				currentStep,
				totalSteps: 6,
				nextStep,
				prevStep,
				goToStep,
				resetStep,
			}}
		>
			{children}
		</OnboardingContext.Provider>
	);
};

// Custom hook for easy access to the onboarding context
export const useOnboarding = (): OnboardingContextProps => {
	const context = useContext(OnboardingContext);
	if (!context) {
		throw new Error("useOnboarding must be used within an OnboardingProvider");
	}
	return context;
};
