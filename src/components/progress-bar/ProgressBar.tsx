type Props = {
	text?: string;
	progress: number;
};

export default function ProgressBar({ text, progress }: Props) {
	let currentProgress = progress;
	if (progress < 0) {
		currentProgress = 0;
	} else if (progress > 100) {
		currentProgress = 100;
	}

	return (
		<>
			<div className="mb-1 mt-4 flex justify-between">
				<span className="text-base font-medium text-gray-200">{text}</span>
				<span className="text-sm font-medium text-gray-200">
					{Math.trunc(progress)}%
				</span>
			</div>
			<div className="h-2.5 w-full animate-pulse rounded-full bg-gray-200 dark:bg-gray-700">
				<div
					className="h-2.5 rounded-full bg-gray-500"
					style={{ width: `${currentProgress}%` }}
				></div>
			</div>
		</>
	);
}
