import type React from "react";
import { cn } from "~/lib/utils";

const baseColors = [
	{ name: "--background", value: "bg-background" },
	{ name: "--foreground", value: "bg-foreground" },
	{ name: "--card", value: "bg-card" },
	{ name: "--card-foreground", value: "bg-card-foreground" },
	{ name: "--popover", value: "bg-popover" },
	{ name: "--popover-foreground", value: "bg-popover-foreground" },
	{ name: "--secondary", value: "bg-secondary" },
	{ name: "--secondary-foreground", value: "bg-secondary-foreground" },
	{ name: "--muted", value: "bg-muted" },
	{ name: "--muted-foreground", value: "bg-muted-foreground" },
	{ name: "--accent", value: "bg-accent" },
	{ name: "--accent-foreground", value: "bg-accent-foreground" },
	{ name: "--destructive", value: "bg-destructive" },
	{ name: "--destructive-foreground", value: "bg-destructive-foreground" },
	{ name: "--border", value: "bg-border" },
	{ name: "--input", value: "bg-input" },
	{ name: "--ring", value: "bg-ring" },
] as const;

const primaryVariants = [
	{ name: "--primary-light", value: "bg-primary-light" },
	{ name: "--primary", value: "bg-primary" },
	{ name: "--primary-dark", value: "bg-primary-dark" },
] as const;

const complementaryVariants = [
	{ name: "--complementary-light", value: "bg-complementary-light" },
	{ name: "--complementary", value: "bg-complementary" },
	{ name: "--complementary-dark", value: "bg-complementary-dark" },
] as const;

const chartColors = [
	{ name: "--chart-1", value: "bg-chart-1" },
	{ name: "--chart-2", value: "bg-chart-2" },
	{ name: "--chart-3", value: "bg-chart-3" },
	{ name: "--chart-4", value: "bg-chart-4" },
	{ name: "--chart-5", value: "bg-chart-5" },
] as const;

const sets = [
	{
		name: "Base Colors",
		colors: baseColors,
	},
	{
		name: "Primary Variants",
		colors: primaryVariants,
	},
	{
		name: "Complementary Variants",
		colors: complementaryVariants,
	},
	{
		name: "Chart Colors",
		colors: chartColors,
	},
] as const;

const ColorPalette: React.FC = () => {
	return (
		<div className="space-y-12 p-8">
			<h1 className="text-foreground text-3xl font-bold">Color Palette</h1>

			{/* Base Colors */}
			{sets.map((set) => (
				<section key={set.name}>
					<h2 className="text-foreground mb-4 text-2xl font-semibold">
						{set.name}
					</h2>
					<div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
						{set.colors.map((color) => (
							<div key={color.name} className="flex flex-col items-center">
								<div
									className={cn("h-24 w-24 rounded shadow-md")}
									style={{ backgroundColor: `hsl(var(${color.name}))` }}
								/>
								<div className="mt-2 text-center">
									<p className="text-foreground font-mono text-sm">
										{color.name}
									</p>
									<p className="text-muted-foreground font-mono text-xs">
										{color.value}
									</p>
								</div>
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
};

export default ColorPalette;
