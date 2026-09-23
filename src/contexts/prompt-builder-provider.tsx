"use client";
import type React from "react";
import { createContext, useCallback, useContext } from "react";
import useLocalStorage from "~/hooks/use-local-storage";
import { type Creativity, DEFAULT_CREATIVITY } from "~/lib/creativity";
import type { EngineId } from "~/lib/engines";
import { asPurpose, DEFAULT_PURPOSE, type Purpose } from "~/lib/purpose";

interface PromptBuilderContextProps {
	selectedMood: string;
	setSelectedMood: React.Dispatch<React.SetStateAction<string>>;
	selectedGenres: string[];
	setSelectedGenres: React.Dispatch<React.SetStateAction<string[]>>;
	selectedArtists: string[];
	setSelectedArtists: React.Dispatch<React.SetStateAction<string[]>>;
	selectedTrackCount: number;
	setSelectedTrackCount: React.Dispatch<React.SetStateAction<number>>;
	creativity: Creativity;
	setCreativity: React.Dispatch<React.SetStateAction<Creativity>>;
	selectedEngine: EngineId;
	setSelectedEngine: React.Dispatch<React.SetStateAction<EngineId>>;
	purpose: Purpose;
	choosePurpose: (purpose: Purpose) => void;
	buildPrompt: () => string;
	resetPrompt: () => void;
}

const PromptBuilderContext = createContext<
	PromptBuilderContextProps | undefined
>(undefined);

export const PromptBuilderProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [selectedMood, setSelectedMood] = useLocalStorage("selectedMood", "");
	const [selectedGenres, setSelectedGenres] = useLocalStorage<string[]>(
		"selectedGenres",
		[],
	);
	const [selectedArtists, setSelectedArtists] = useLocalStorage<string[]>(
		"selectedArtists",
		[],
	);
	const [selectedTrackCount, setSelectedTrackCount] = useLocalStorage(
		"selectedTrackCount",
		10,
	);
	const [selectedEngine, setSelectedEngine] = useLocalStorage<EngineId>(
		"selectedEngine",
		"chatgpt",
	);
	const [creativity, setCreativity] = useLocalStorage<Creativity>(
		"creativity",
		DEFAULT_CREATIVITY,
	);
	const [storedPurpose, setPurpose] = useLocalStorage<Purpose>(
		"purpose",
		DEFAULT_PURPOSE,
	);
	// Storage is outside the type system: an edited or retired value would
	// otherwise index the purpose table with a key it does not have.
	const purpose = asPurpose(storedPurpose);
	const choosePurpose = (next: Purpose) => setPurpose(next);

	const buildPrompt = () =>
		(() => {
			let prompt = `Create a playlist for a ${selectedMood} mood featuring ${selectedGenres.join(
				", ",
			)} genres`;
			if (selectedArtists.length > 0) {
				prompt += `, highlighting artists: ${selectedArtists.join(", ")}`;
			}
			return prompt;
		})();

	const resetPrompt = useCallback(() => {
		setSelectedMood("");
		setSelectedGenres([]);
		setSelectedArtists([]);
		setSelectedTrackCount(10);
		setSelectedEngine("chatgpt");
	}, [
		setSelectedMood,
		setSelectedGenres,
		setSelectedArtists,
		setSelectedTrackCount,
		setSelectedEngine,
	]);

	return (
		<PromptBuilderContext.Provider
			value={{
				selectedMood,
				selectedGenres,
				selectedArtists,
				selectedTrackCount,
				creativity,
				selectedEngine,
				setSelectedMood,
				setSelectedGenres,
				setSelectedArtists,
				setSelectedTrackCount,
				setSelectedEngine,
				setCreativity,
				purpose,
				choosePurpose,
				buildPrompt,
				resetPrompt,
			}}
		>
			{children}
		</PromptBuilderContext.Provider>
	);
};

export const usePromptBuilder = () => {
	const context = useContext(PromptBuilderContext);
	if (!context) {
		throw new Error(
			"usePromptBuilder must be used within a PromptBuilderProvider",
		);
	}
	return context;
};
