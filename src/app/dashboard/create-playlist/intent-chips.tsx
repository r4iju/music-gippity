"use client";

import type { Intent } from "~/lib/intent";
import { type Chip, intentChips } from "~/lib/intent-chips";
import { PURPOSE, type Purpose } from "~/lib/purpose";

/**
 * Read-only chips: the purpose the listener picked, then what the flow read
 * from the brief. Playlists made before purpose existed have none.
 */
export function IntentChips({
	intent,
	purpose,
}: {
	intent: Intent | null | undefined;
	purpose?: Purpose;
}) {
	const chips: Chip[] = [
		...(purpose
			? [
					{
						key: "purpose",
						label: PURPOSE[purpose].label,
						title: "You picked this purpose",
					},
				]
			: []),
		...(intent ? intentChips(intent) : []),
	];
	if (!chips.length) return null;
	return (
		<ul
			aria-label="What this playlist is for and what we read from your brief"
			className="flex flex-wrap gap-1.5"
		>
			{chips.map((chip) => (
				<li
					key={chip.key}
					title={
						chip.title ??
						(chip.quote ? `From your brief: “${chip.quote}”` : undefined)
					}
					className="border-muted bg-muted/40 text-muted-foreground rounded-full border px-2 py-0.5 text-xs"
				>
					{chip.label}
				</li>
			))}
		</ul>
	);
}
