"use client";

import type { FC } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface RHFTextFieldProps {
	name: string;
	helperText?: React.ReactNode;
	type?: React.HTMLInputTypeAttribute;
	placeholder?: string;
	label?: string;
	multiline?: boolean;
	rows?: number;
}

const RHFTextField: FC<RHFTextFieldProps> = ({
	name,
	helperText,
	type = "text",
	placeholder,
	label,
	multiline,
}) => {
	const { control } = useFormContext();

	return (
		<Controller
			name={name}
			control={control}
			render={({ field, fieldState: { error } }) => {
				return (
					<div className="mx-1">
						{label && <Label>{label}</Label>}
						{multiline ? (
							<Input
								className="border-1 border-muted-foreground bg-background focus-visible:border-secondary"
								{...field}
								id={name}
								multiple
								placeholder={placeholder}
							/>
						) : (
							<Input
								{...field}
								className="border-muted-foreground bg-background focus-visible:border-secondary"
								id={name}
								type={type}
								placeholder={placeholder}
								value={
									// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
									typeof field.value === "number" && field.value === 0
										? ""
										: field.value
								}
							/>
						)}
						{error && (
							<p className="mt-1 text-sm text-destructive">{error.message}</p>
						)}
						{helperText && !error && (
							<p className="mt-1 text-sm text-muted-foreground">{helperText}</p>
						)}
					</div>
				);
			}}
		/>
	);
};

export default RHFTextField;
