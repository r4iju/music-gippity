"use client";
import {
	createContext,
	type FC,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

export type SnackbarType = "success" | "error" | "warning" | "info";

interface Snackbar {
	id: number;
	message: string;
	type: SnackbarType;
}

interface SnackbarContextType {
	open: (message: string, type?: SnackbarType) => void;
}

const SnackbarContext = createContext<SnackbarContextType | null>(null);

interface SnackbarProviderProps {
	children: ReactNode;
}

const SnackbarProvider: FC<SnackbarProviderProps> = ({ children }) => {
	const [snackbars, setSnackbars] = useState<Snackbar[]>([]);

	const open = useCallback((message: string, type: SnackbarType = "info") => {
		const id = Date.now();
		setSnackbars((oldSnackbars) => [...oldSnackbars, { id, message, type }]);
	}, []);

	const removeSnackbar = useCallback((id: number) => {
		setSnackbars((oldSnackbars) =>
			oldSnackbars.filter((snackbar) => snackbar.id !== id),
		);
	}, []);

	useEffect(() => {
		if (snackbars.length > 0) {
			const timer = setTimeout(() => {
				if (snackbars[0]) {
					removeSnackbar(snackbars[0].id);
				}
			}, 3000);

			return () => clearTimeout(timer);
		}
		return;
	}, [snackbars, removeSnackbar]);

	return (
		<SnackbarContext.Provider value={{ open }}>
			{children}
			<div className="fixed bottom-4 left-4 z-50 space-y-2">
				{snackbars.map((snackbar) => (
					<div
						key={snackbar.id}
						className={`rounded p-4 text-white shadow-md ${
							snackbar.type === "success"
								? "bg-green-500"
								: snackbar.type === "error"
									? "bg-red-500"
									: snackbar.type === "warning"
										? "bg-yellow-500"
										: "bg-blue-500" // Default for 'info' and any other unspecified type
						}`}
					>
						{snackbar.message}
					</div>
				))}
			</div>
		</SnackbarContext.Provider>
	);
};

export const useSnackbar = () => {
	const context = useContext(SnackbarContext);
	if (!context) {
		throw new Error("useSnackbar must be used within a SnackbarProvider");
	}
	return context;
};

export default SnackbarProvider;
