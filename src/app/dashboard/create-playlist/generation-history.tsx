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
				<AccordionTrigger className="min-h-11 py-3">
					Previous playlists · {data.length}
				</AccordionTrigger>
				<AccordionContent>
					{error ? (
						<p role="alert" className="text-sm p-2">
							History could not be loaded. It will retry automatically.
						</p>
					) : (
						<ul className="max-h-64 overflow-auto divide-y">
							{data.map((generation) => (
								<li key={generation.id} className="py-2">
									<Link
										className="text-sm underline"
										href={`/dashboard/playlists/${generation.id}`}
									>
										{generation.name === "Just a moment..."
											? generation.prompt.slice(0, 80)
											: generation.name}
									</Link>
									<span className="text-xs text-muted-foreground ml-2">
										{generation.status} ·{" "}
										{new Date(generation.createdAt).toLocaleString()}
									</span>
								</li>
							))}
						</ul>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
