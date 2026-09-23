type Props = {
	checked: boolean;
	onChange: () => void;
	disabled?: boolean;
};

const Checkbox = ({ checked, onChange, disabled = false }: Props) => {
	const handleClick = () => {
		if (!disabled) {
			onChange();
		}
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: Custom styled checkbox
		<div
			className={`flex h-full items-center justify-center p-1 ${
				!disabled ? "cursor-pointer" : "cursor-not-allowed"
			}`}
			onClick={handleClick}
			role="checkbox"
			aria-checked={checked}
			tabIndex={disabled ? -1 : 0}
			onKeyDown={(e) => {
				if (!disabled && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					onChange();
				}
			}}
		>
			<div
				className={`flex h-6 w-6 items-center justify-center rounded border transition duration-150 ease-in-out ${
					checked
						? "border-blue-500 bg-blue-500"
						: "border-gray-300 hover:border-gray-400"
				} ${disabled ? "opacity-50" : ""}`}
			>
				{checked && (
					<svg
						className="h-4 w-4 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						xmlns="http://www.w3.org/2000/svg"
					>
						<title>Check</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={4}
							d="M5 13l4 4L19 7"
						></path>
					</svg>
				)}
			</div>
		</div>
	);
};

export default Checkbox;
