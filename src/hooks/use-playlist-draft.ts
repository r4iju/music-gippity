"use client";

import {
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	emptyDraft,
	type PlaylistDraft,
	restoreDraft,
} from "~/lib/playlist-generation";

/** Hydrate once after mount; never persist the server's empty default first. */
export function usePlaylistDraft(
	userId: string,
	pendingKey: string | null,
	draftCacheRef: RefObject<PlaylistDraft | null>,
) {
	const storageKey = `playlist:${userId}`;
	const initialPendingKeyRef = useRef(pendingKey);
	const [playlist, setState] = useState<PlaylistDraft>(emptyDraft);
	const current = useRef(playlist);
	const [storageWarning, setStorageWarning] = useState(false);
	const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
	// External system: hydrate the browser's localStorage draft after mount.
	useEffect(() => {
		try {
			const restored =
				draftCacheRef.current ??
				restoreDraft(localStorage.getItem(storageKey), setRecoveryWarning);
			// Generated content is fetched by URL. Only an unacknowledged create keeps its retry key.
			current.current =
				restored.remote &&
				!(
					restored.remote.pending &&
					restored.remote.id === initialPendingKeyRef.current
				)
					? {
							...emptyDraft(),
							brief: restored.brief,
							request: restored.request,
						}
					: restored;
			draftCacheRef.current = current.current;
			setState(current.current);
		} catch {
			setStorageWarning(true);
		}
	}, [storageKey, draftCacheRef]);
	const setPlaylist = useCallback(
		(action: SetStateAction<PlaylistDraft>) => {
			const next =
				typeof action === "function" ? action(current.current) : action;
			if (next === current.current) return;
			setRecoveryWarning(null);
			current.current = next;
			setState(current.current);
			const cache =
				next.remote && !next.remote.pending
					? { ...emptyDraft(), brief: next.brief, request: next.request }
					: next;
			draftCacheRef.current = cache;
			try {
				localStorage.setItem(storageKey, JSON.stringify(cache));
				setStorageWarning(false);
			} catch {
				setStorageWarning(true);
			}
		},
		[storageKey, draftCacheRef],
	);
	return {
		playlist: {
			...playlist,
			isLoading:
				playlist.generation.status === "running" ||
				playlist.generation.status === "queued",
		},
		setPlaylist,
		current,
		storageWarning,
		recoveryWarning,
	};
}
