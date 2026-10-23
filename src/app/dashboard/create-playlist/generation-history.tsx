"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "~/components/ui/accordion";
import { listGenerations } from "~/lib/generation-client";
import type { Generation } from "~/lib/playlist-generation";

// Finished playlists need no label; the rest say why they look unfinished.
const STATUS_LABELS: Record<Generation["status"], string> = {
	idle: "",
	queued: "Queued",
	running: "Generating",
	interrupted: "Stopped",
	complete: "",
	kept: "Partial",
};

export function GenerationHistory() {
	const { data, error } = useQuery({
		queryKey: ["playlist-generations"],
		queryFn: listGenerations,
		refetchInterval: 10_000,
	});
	if (!data || data.length < 2) return null;
	return (
		<Accordion
			type="single"
			collapsible
			className="w-full min-w-0 text-muted-foreground"
		>
			<AccordionItem value="history" className="border-0">
				<AccordionTrigger className="text-foreground min-h-11 py-3 text-sm font-medium hover:no-underline">
					Previous playlists · {data.length}
				</AccordionTrigger>
				<AccordionContent>
					{error ? (
						<p role="alert" className="text-sm p-2">
							History could not be loaded. It will retry automatically.
						</p>
					) : (
						<ul className="divide-border/60 max-h-72 divide-y overflow-auto">
							{data.map((generation) => (
								<li key={generation.id}>
									<Link
										className="hover:bg-foreground/[0.04] focus-visible:ring-ring flex min-w-0 items-baseline justify-between gap-4 rounded-md px-2 py-2.5 focus-visible:outline-hidden focus-visible:ring-2"
										href={`/dashboard/playlists/${generation.id}`}
									>
										<span className="text-foreground truncate text-sm">
											{generation.name === "Just a moment..."
												? generation.prompt.slice(0, 80)
												: generation.name}
										</span>
										<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
											{STATUS_LABELS[generation.status]
												? `${STATUS_LABELS[generation.status]} · `
												: ""}
											{new Date(generation.createdAt).toLocaleDateString(
												undefined,
												{ month: "short", day: "numeric" },
											)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
