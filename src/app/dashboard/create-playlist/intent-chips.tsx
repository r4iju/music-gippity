"use client";

import type { Intent } from "~/lib/intent";
import { type Chip, intentChips } from "~/lib/intent-chips";
import { PURPOSE, type Purpose } from "~/lib/purpose";

/**
 * The purpose the listener picked, then what the flow read from the brief.
 * Playlists made before purpose existed have none. Chips are read-only
 * except the classics request, which offers `onUndoClassics` when given.
 */
export function IntentChips({
	intent,
	purpose,
	onUndoClassics,
}: {
	intent: Intent | null | undefined;
	purpose?: Purpose;
	/** Starts a new generation with the classics request switched off. */
	onUndoClassics?: () => void;
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
					{chip.key === "classics" && onUndoClassics && (
						<button
							type="button"
							onClick={onUndoClassics}
							aria-label="Undo classics request: generate again without it"
							className="text-foreground focus-visible:ring-ring ml-1.5 rounded-sm font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2"
						>
							Undo
						</button>
					)}
				</li>
			))}
		</ul>
	);
}
