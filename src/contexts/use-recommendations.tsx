"use client";

import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { usePromptBuilder } from "~/contexts/prompt-builder-provider";
import { throttle } from "~/utils/throttle";
import useLocalStorage from "../hooks/use-local-storage";

export type Recommendation = {
	value: string;
	label: string;
};

export type RecommendationRequest = {
	engine: string;
	mood: string;
	genres: string[];
};

// Create a context to hold recommendations state and the fetching function.
type RecommendationsContextType = {
	recommendations: Recommendation[];
	ignoredArtists: string[];
	loading: boolean;
	error: string | null;
	expectedCount: number;
	fetchRecommendations: () => Promise<void>;
	resetRecommendations: () => void;
	setRecommendations: Dispatch<SetStateAction<Recommendation[]>>;
	setIgnoredArtists: Dispatch<SetStateAction<string[]>>;
};

const RecommendationsContext = createContext<
	RecommendationsContextType | undefined
>(undefined);

// Provider component that encapsulates recommendations logic
export const RecommendationsProvider: React.FC<{
	children: React.ReactNode;
}> = ({ children }) => {
	const [recommendations, setRecommendations] = useLocalStorage<
		Recommendation[]
	>("recommendations", []);
	const [ignoredArtists, setIgnoredArtists] = useLocalStorage<string[]>(
		"ignoredArtists",
		[],
	);
	const {
		selectedEngine,
		selectedMood,
		selectedGenres,
		selectedArtists,
		creativity,
	} = usePromptBuilder();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const TOTAL_EXPECTED_COUNT = 15;
	const expectedCount = useMemo(() => {
		// Ensure we never go negative.
		return Math.max(TOTAL_EXPECTED_COUNT - selectedArtists.length, 0);
	}, [selectedArtists]);

	const fetchRecommendations = useCallback(async () => {
		if (!selectedMood) {
			console.error("useRecommendations: missing required parameters", {
				selectedMood,
			});
			return;
		}
		if (loading) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/edge/recommendations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					engine: selectedEngine,
					mood: selectedMood,
					genres: selectedGenres,
					selectedArtists,
					rejectedArtists: ignoredArtists,
					expectedCount,
					creativity,
				}),
			});

			if (!res.ok) {
				throw new Error(`Error: ${res.statusText}`);
			}

			// With both engines streaming one complete JSON object per line,
			// we can parse the stream uniformly as NDJSON.
			// biome-ignore lint/style/noNonNullAssertion: Helper stream assumption
			const reader = res.body!.getReader();
			const decoder = new TextDecoder("utf-8");
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// Append the new chunk to the buffer.
				buffer += decoder.decode(value, { stream: true });
				// Split the buffer on newline characters.
				const lines = buffer.split("\n");
				// Keep any partial line for next iteration.
				buffer = lines.pop() || "";

				// Process each full line.
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const parsedObj = JSON.parse(line) as { artist: string };
						if (!parsedObj.artist) continue;

						const recommendation: Recommendation = {
							value: parsedObj.artist.toLowerCase().replace(/\s+/g, "-"),
							label: parsedObj.artist,
						};

						setRecommendations((prev) => {
							if (prev.some((p) => p.value === recommendation.value)) {
								return prev;
							}
							return [...prev, recommendation];
						});
					} catch (e) {
						console.error("Error parsing NDJSON line:", e, "Line:", line);
					}
				}
			}
		} catch (e: unknown) {
			console.error("fetchRecommendations: error encountered", e);
			setError(e instanceof Error ? e.message : "An unknown error occurred");
		} finally {
			setLoading(false);
		}
	}, [
		selectedMood,
		selectedGenres,
		loading,
		selectedEngine,
		selectedArtists,
		ignoredArtists,
		expectedCount,
		setRecommendations,
		creativity,
	]);

	const resetRecommendations = useCallback(() => {
		// add not selected artists to ignored artists
		setIgnoredArtists([
			...ignoredArtists,
			...selectedArtists.filter((artist) => !ignoredArtists.includes(artist)),
		]);
		setRecommendations([]);
	}, [setIgnoredArtists, ignoredArtists, selectedArtists, setRecommendations]);

	// Define a throttle wait time (in milliseconds)
	const THROTTLE_WAIT = 3000;

	// Wrap fetchRecommendations in a throttle so that rapid calls are prevented.
	const throttledFetchRef = useRef(
		throttle(fetchRecommendations, THROTTLE_WAIT),
	);

	useEffect(() => {
		throttledFetchRef.current = throttle(fetchRecommendations, THROTTLE_WAIT);
	}, [fetchRecommendations]);

	return (
		<RecommendationsContext.Provider
			value={{
				recommendations,
				ignoredArtists,
				loading,
				error,
				expectedCount,
				fetchRecommendations: throttledFetchRef.current,
				resetRecommendations,
				setIgnoredArtists,
				setRecommendations,
			}}
		>
			{children}
		</RecommendationsContext.Provider>
	);
};

// Custom hook to use the recommendations context.
export function useRecommendations() {
	const context = useContext(RecommendationsContext);
	if (!context) {
		throw new Error(
			"useRecommendations must be used within a RecommendationsProvider",
		);
	}
	return context;
}
