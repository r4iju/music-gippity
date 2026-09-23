import { cn } from "~/lib/utils";

/** Marks text the AI curator wrote so it cannot be read as Spotify metadata. */
export function AiCuratorLabel({ className }: { className?: string }) {
	return (
		<span
			title="Written by the AI curator, not Spotify"
			className={cn(
				"border-muted text-muted-foreground inline-block shrink-0 rounded-full border px-1.5 align-middle text-[10px] leading-4 not-italic",
				className,
			)}
		>
			AI curator
		</span>
	);
}
