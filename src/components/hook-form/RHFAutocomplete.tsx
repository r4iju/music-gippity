"use client";

import type React from "react";
import { Controller, useFormContext } from "react-hook-form";

interface Option {
	label: string;
	value: string | number;
}

interface RHFAutocompleteProps {
	name: string;
	label?: string;
	options: Option[];
	placeholder?: string;
}

const RHFAutocomplete: React.FC<RHFAutocompleteProps> = ({
	name,
	label,
	options,
	placeholder,
}) => {
	const { control } = useFormContext();

	return (
		<div className="relative">
			{label && (
				<label
					htmlFor={name}
					className="block text-sm font-medium text-gray-700"
				>
					{label}
				</label>
			)}
			<Controller
				name={name}
				control={control}
				render={({ field }) => (
					<select
						{...field}
						id={name}
						className="mt-1 block w-full rounded-md border-gray-300 py-2 pr-10 pl-3 text-base focus:border-indigo-500 focus:ring-indigo-500 focus:outline-hidden sm:text-sm"
					>
						{placeholder && (
							<option value="" disabled>
								{placeholder}
							</option>
						)}
						{options.map((option, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: Option values are unique but index can be fallback
							<option key={index} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				)}
			/>
		</div>
	);
};

export default RHFAutocomplete;
