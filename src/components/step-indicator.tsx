import type React from "react";
import { cn } from "~/lib/utils";

export interface StepIndicatorProps {
	currentStep: number;
	totalSteps: number;
}

const StepIndicator: React.FC<StepIndicatorProps> = ({
	currentStep,
	totalSteps,
}) => {
	return (
		<div className="mt-4 flex w-full items-center justify-center gap-1">
			{Array.from({ length: totalSteps }).map((_, index) => {
				const stepNum = index + 1;
				return (
					<div
						key={stepNum}
						className={cn(
							"flex h-6 w-full items-center justify-center border",
							{
								"border-primary bg-primary text-primary-foreground":
									stepNum <= currentStep,
								"border-muted bg-muted text-foreground": stepNum > currentStep,
								"rounded-l-sm": stepNum === 1,
								"rounded-r-sm": stepNum === totalSteps,
							},
						)}
					>
						{stepNum}
					</div>
				);
			})}
		</div>
	);
};

export default StepIndicator;
