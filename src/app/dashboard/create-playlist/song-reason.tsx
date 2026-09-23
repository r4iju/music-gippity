import { AiCuratorLabel } from "~/components/ai-curator-label";

/** The curator's one line on why the recording belongs, once it arrives. */
export function SongReason({ reason }: { reason: string | undefined }) {
	if (!reason) return null;
	return (
		<span
			role="note"
			aria-label={`AI curator's note: ${reason}`}
			className="flex min-w-0 items-center gap-1.5"
		>
			<AiCuratorLabel />
			<span
				title={reason}
				className="text-muted-foreground/80 truncate text-xs italic"
			>
				{reason}
			</span>
		</span>
	);
}
