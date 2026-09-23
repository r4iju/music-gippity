import type { Intent } from "./intent";

export type Chip = {
	key: string;
	label: string;
	quote?: string;
	title?: string;
};

function eraLabel(era: NonNullable<Intent["era"]>): string | null {
	if (era.start !== null && era.end !== null)
		return era.start === era.end ? `${era.start}` : `${era.start}–${era.end}`;
	if (era.start !== null) return `From ${era.start}`;
	if (era.end !== null) return `Until ${era.end}`;
	return null;
}

/** The intent as a flat list of chips, in the order a listener reads a brief. */
export function intentChips(intent: Intent): Chip[] {
	const chips: Chip[] = intent.genres.map((genre) => ({
		key: `genre:${genre}`,
		label: genre,
	}));
	const era = intent.era && eraLabel(intent.era);
	if (era) chips.push({ key: "era", label: era });
	if (intent.mood) chips.push({ key: "mood", label: intent.mood });
	if (intent.energy) chips.push({ key: "energy", label: intent.energy });
	if (intent.language) chips.push({ key: "language", label: intent.language });
	if (intent.vocalRule.rule === "no-vocals")
		chips.push({
			key: "vocals",
			label: "No vocals",
			quote: intent.vocalRule.quote ?? undefined,
		});
	if (intent.vocalRule.rule === "vocals-welcome")
		chips.push({
			key: "vocals",
			label: "Vocals welcome",
			quote: intent.vocalRule.quote ?? undefined,
		});
	for (const rule of intent.exclusions)
		chips.push({
			key: `exclude:${rule.kind}:${rule.value}`,
			label: `No ${rule.value}`,
			quote: rule.quote,
		});
	for (const rule of intent.mustInclude)
		chips.push({
			key: `include:${rule.artist}`,
			label: `Include ${rule.artist}`,
			quote: rule.quote,
		});
	if (intent.album)
		chips.push({
			key: "album",
			label: "Whole album",
			quote: intent.album.quote,
		});
	// The reader may repeat a value; keys must still be unique.
	const seen = new Map<string, number>();
	return chips.map((chip) => {
		const dupes = seen.get(chip.key) ?? 0;
		seen.set(chip.key, dupes + 1);
		return dupes ? { ...chip, key: `${chip.key}#${dupes}` } : chip;
	});
}
