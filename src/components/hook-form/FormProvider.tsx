"use client";

import type { FormEvent } from "react";
import {
	type FieldValues,
	FormProvider as Form,
	type UseFormReturn,
} from "react-hook-form";

// ----------------------------------------------------------------------

type Props<T extends FieldValues> = {
	children: React.ReactNode;
	methods: UseFormReturn<T>;
	onSubmit?: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export default function FormProvider<T extends FieldValues>({
	children,
	onSubmit,
	methods,
}: Props<T>) {
	return (
		<Form {...methods}>
			<form onSubmit={onSubmit}>{children}</form>
		</Form>
	);
}
