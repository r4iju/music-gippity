"use client";

import { useOnboarding } from "../../../contexts/step-provider";
import PlaylistTable from "./playlist-table";
import StepOne from "./step-1";
import StepTwo from "./step-2";
import StepThree from "./step-3";
import StepFour from "./step-4";
import StepFive from "./step-5";
import StepSix from "./step-6";

export function Steps() {
	const { currentStep } = useOnboarding();

	return (
		<>
			{currentStep === 1 && <StepOne />}
			{currentStep === 2 && <StepTwo />}
			{currentStep === 3 && <StepThree />}
			{currentStep === 4 && <StepFour />}
			{currentStep === 5 && <StepFive />}
			{currentStep === 6 && <StepSix />}
			<PlaylistTable />
		</>
	);
}
