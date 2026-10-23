import { Sparkles } from "lucide-react";

/** The curator's one line on why the recording belongs, once it arrives. */
export function SongReason({ reason }: { reason: string | undefined }) {
	if (!reason) return null;
	return (
		<span
			role="note"
			aria-label={`AI curator's note: ${reason}`}
			className="text-muted-foreground/80 flex min-w-0 items-center gap-1.5 text-xs leading-5"
		>
			<Sparkles
				aria-hidden="true"
				className="text-complementaryLight size-3 shrink-0"
			/>
			<span className="sr-only">AI curator: </span>
			<span title={reason} className="truncate italic">
				{reason}
			</span>
		</span>
	);
}
