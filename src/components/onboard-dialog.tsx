"use client";

import { XIcon } from "lucide-react";
import React, { type ReactNode, useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";

interface CustomDialogProps {
	open: boolean;
	onClose?: () => void;
	children: ReactNode;
}

export const CustomDialog: React.FC<CustomDialogProps> = ({
	open,
	onClose,
	children,
}) => {
	const [isVisible, setIsVisible] = useState(open);
	const [animationClass, setAnimationClass] = useState(
		"animate-slide-in-right",
	);

	useEffect(() => {
		if (open) {
			setIsVisible(true);
			setAnimationClass("animate-slide-in-right");
			return;
		} else {
			setAnimationClass("animate-slide-out-left");
			const timer = setTimeout(() => setIsVisible(false), 300); // matches your animation duration
			return () => clearTimeout(timer);
		}
	}, [open]);

	// Disable scrolling on the body when the dialog is visible.
	useEffect(() => {
		if (isVisible) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [isVisible]);

	if (!isVisible) return null;

	return (
		<>
			{/* Backdrop */}
			<div className="fixed inset-0 z-40 bg-black/70" />

			{/* Scrollable Centering Container */}
			<div className="fixed inset-0 z-50 mx-auto max-w-[calc(100vw-1rem)] overflow-y-auto">
				<div className="flex items-start justify-center">
					{/* Dialog Container with max-height and vertical scrolling */}
					<div
						className={cn(
							"bg-background mt-[20vh] max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border p-6 shadow-lg duration-200",
							animationClass,
						)}
					>
						<div className="my-[-4px] flex justify-end">
							{onClose && (
								<Button
									size="icon"
									className="size-6 rounded-full"
									variant="outline"
									onClick={onClose}
								>
									<XIcon className="text-muted-foreground size-4" />
								</Button>
							)}
						</div>
						{children}
					</div>
				</div>
			</div>
		</>
	);
};

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
	children: ReactNode;
}
export const DialogHeader: React.FC<DialogHeaderProps> = ({
	children,
	className,
	...props
}) => {
	return (
		<div className={cn("flex flex-col gap-y-4", className)} {...props}>
			{children}
		</div>
	);
};

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
	children: ReactNode;
}
export const DialogTitle: React.FC<DialogTitleProps> = ({
	children,
	className,
	...props
}) => {
	return (
		<h2 className={cn("text-primary text-2xl font-bold", className)} {...props}>
			{children}
		</h2>
	);
};

interface DialogDescriptionProps
	extends React.HTMLAttributes<HTMLParagraphElement> {
	children: ReactNode;
}
export const DialogDescription: React.FC<DialogDescriptionProps> = ({
	children,
	className,
	...props
}) => {
	return (
		<p className={cn("text-muted-foreground", className)} {...props}>
			{children}
		</p>
	);
};

export default CustomDialog;
