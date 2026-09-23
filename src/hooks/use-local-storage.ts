import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

function useLocalStorage<T>(
	key: string,
	initialValue: T | (() => T),
	options?: { syncQueryParam?: boolean; queryKey?: string },
): [T, React.Dispatch<React.SetStateAction<T>>] {
	// Add Next.js navigation hooks.
	const router = useRouter();
	const searchParams = useSearchParams();

	// Initialize state with a lazy initializer.
	// Now check for query param first if sync is enabled.
	const [storedValue, setStoredValue] = useState<T>(() => {
		if (typeof window === "undefined") {
			// If window is undefined (e.g. during SSR), return the initial value directly.
			return typeof initialValue === "function"
				? (initialValue as () => T)()
				: initialValue;
		}

		// Check query parameters if sync is enabled.
		if (options?.syncQueryParam) {
			const queryKey = options.queryKey ?? key;
			const params = new URLSearchParams(searchParams.toString());
			if (params.has(queryKey)) {
				const paramValue = params.get(queryKey);
				if (paramValue !== null) {
					try {
						// Attempt to parse the query param value as JSON.
						return JSON.parse(paramValue) as T;
					} catch (error) {
						console.error(`Error parsing query param “${queryKey}”:`, error);
						return paramValue as unknown as T;
					}
				}
			}
		}

		try {
			const item = window.localStorage.getItem(key);
			// If an item exists, parse and return it; otherwise, return initialValue.
			return item
				? (JSON.parse(item) as T)
				: typeof initialValue === "function"
					? (initialValue as () => T)()
					: initialValue;
		} catch (error) {
			console.error(`Error reading localStorage key “${key}”:`, error);
			return typeof initialValue === "function"
				? (initialValue as () => T)()
				: initialValue;
		}
	});

	// Update localStorage and query parameters whenever the storedValue changes.
	useEffect(() => {
		if (typeof window !== "undefined") {
			try {
				window.localStorage.setItem(key, JSON.stringify(storedValue));
				if (options?.syncQueryParam) {
					const queryKey = options.queryKey ?? key;
					const params = new URLSearchParams(searchParams.toString());
					params.set(queryKey, JSON.stringify(storedValue));
					const newUrl = `${window.location.pathname}?${params.toString()}`;
					const currentUrl =
						window.location.pathname + (window.location.search || "");
					if (currentUrl !== newUrl) {
						setTimeout(() => router.replace(newUrl), 0);
					}
				}
			} catch (error) {
				console.error(`Error setting localStorage key “${key}”:`, error);
			}
		}
	}, [
		key,
		storedValue,
		options?.syncQueryParam,
		options?.queryKey,
		router,
		searchParams,
	]);

	// Enhanced setter for functional updates.
	const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
		setStoredValue((prevValue) => {
			const valueToStore = value instanceof Function ? value(prevValue) : value;
			try {
				window.localStorage.setItem(key, JSON.stringify(valueToStore));
				if (typeof window !== "undefined" && options?.syncQueryParam) {
					const queryKey = options.queryKey ?? key;
					const params = new URLSearchParams(searchParams.toString());
					params.set(queryKey, JSON.stringify(valueToStore));
					const newUrl = `${window.location.pathname}?${params.toString()}`;
					const currentUrl =
						window.location.pathname + (window.location.search || "");
					if (currentUrl !== newUrl) {
						setTimeout(() => router.replace(newUrl), 0);
					}
				}
			} catch (error) {
				console.error(`Error setting localStorage key “${key}”:`, error);
			}
			return valueToStore;
		});
	};

	return [storedValue, setValue];
}

export default useLocalStorage;
