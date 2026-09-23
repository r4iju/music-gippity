import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useContext,
	useEffect,
	useState,
} from "react";

interface AudioContextType {
	playingUrl: string | null;
	setPlayingUrl: Dispatch<SetStateAction<string | null>>;
}

const AudioContext = createContext<AudioContextType>({
	playingUrl: null,
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	setPlayingUrl: () => {},
});

export const useAudioContext = () => useContext(AudioContext);

type Props = {
	children: React.ReactNode;
};

export const AudioProvider = ({ children }: Props) => {
	const [playingUrl, setPlayingUrl] = useState<string | null>(null);

	return (
		<AudioContext.Provider value={{ playingUrl, setPlayingUrl }}>
			{children}
		</AudioContext.Provider>
	);
};

export const useAudio = (audioUrl: string | null) => {
	const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isError, setIsError] = useState(false);
	const { playingUrl, setPlayingUrl } = useAudioContext();
	const [isPlaying, setIsPlaying] = useState<boolean>(playingUrl === audioUrl);

	useEffect(() => {
		if (!audioUrl) return;

		const newAudio = new Audio(audioUrl);
		setAudio(newAudio);

		const onPlay = () => setIsLoading(true);
		const onPlaying = () => setIsLoading(false);
		const onError = () => {
			setIsError(true);
			setIsLoading(false);
		};
		const onEnded = () => {
			setPlayingUrl(null);
		};

		newAudio.addEventListener("play", onPlay);
		newAudio.addEventListener("playing", onPlaying);
		newAudio.addEventListener("error", onError);
		newAudio.addEventListener("ended", onEnded);

		return () => {
			newAudio.removeEventListener("play", onPlay);
			newAudio.removeEventListener("playing", onPlaying);
			newAudio.removeEventListener("error", onError);
			newAudio.removeEventListener("ended", onEnded);
			newAudio.pause();
		};
	}, [audioUrl, setPlayingUrl]);

	useEffect(() => {
		setIsPlaying(playingUrl === audioUrl);
	}, [playingUrl, audioUrl]);

	const togglePlay = () => {
		if (isPlaying) {
			setPlayingUrl(null);
			audio?.pause();
		} else {
			setPlayingUrl(audioUrl);
			audio?.play().catch(() => setIsError(true));
		}
	};

	useEffect(() => {
		if (audio) {
			if (isPlaying) {
				audio.play().catch(() => setIsError(true));
			} else {
				audio.pause();
			}
		}
	}, [isPlaying, audio]);

	return { isPlaying, isLoading, isError, togglePlay };
};
