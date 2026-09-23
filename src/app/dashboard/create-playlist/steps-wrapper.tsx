"use client";

import dynamic from "next/dynamic";

const Steps = dynamic(async () => (await import("./steps")).Steps, {
	ssr: false,
});

export function StepWrapper() {
	return <Steps />;
}
