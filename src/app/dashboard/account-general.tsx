"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { RHFTextField } from "~/components/hook-form";
import FormProvider from "~/components/hook-form/FormProvider";
import { useSnackbar } from "~/components/snackbar";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";

const UpdateUserSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email("Email must be a valid email address"),
});

type FormValuesProps = z.infer<typeof UpdateUserSchema>;

type Props = {
	user: Session["user"];
	tokenUsage: RouterOutputs["account"]["getTokenUsage"];
};
export default function AccountGeneral({ user, tokenUsage }: Props) {
	const { update: updateSession } = useSession();
	const router = useRouter();

	const snackbar = useSnackbar();
	const { mutate: updateUser, isPending: isUpdating } =
		api.account.updateUser.useMutation();
	const { mutate: deleteAccount, isPending: isDeleting } =
		api.account.deleteAccount.useMutation({
			onSuccess: () => signOut({ redirectTo: "/" }),
			onError: () => {
				snackbar.open("Could not delete your data, please try again", "error");
			},
		});

	const methods = useForm<FormValuesProps>({
		resolver: zodResolver(UpdateUserSchema),
		defaultValues: {
			name: user.name ?? "",
			email: user.email ?? "",
		},
	});

	const { handleSubmit } = methods;

	const onSubmit = (data: FormValuesProps) => {
		updateUser(data, {
			onSuccess: () => {
				snackbar.open("Account updated successfully", "success");
				updateSession({
					...data,
				})
					.then(() => {
						router.refresh();
					})
					.catch(console.error);
			},
			onError: () => {
				snackbar.open("Something went wrong, please try again", "error");
			},
		});
	};

	return (
		<Card className="bg-muted flex w-full max-w-[calc(100vw-1rem)] flex-col gap-4 p-5 shadow-lg">
			{/* account settings */}
			<h2 className="text-xl font-bold">Account Settings</h2>
			<FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<RHFTextField name="name" label="User Name" />
					<RHFTextField name="email" label="Email" />
				</div>
				<div className="mt-6 flex justify-end">
					<Button type="submit" disabled={isUpdating}>
						{isUpdating && (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Saving...
							</>
						)}
						{!isUpdating && "Save Changes"}
					</Button>
				</div>
			</FormProvider>
			<h2 className="text-xl font-bold">LLM Token Usage</h2>
			<div className="flex flex-col gap-2">
				{/* token usage, as table */}
				{/* rounded */}
				<table
					className="text-foreground w-full text-left text-sm"
					style={{
						borderRadius: "10px",
					}}
				>
					<thead className="text-muted-foreground text-xs uppercase">
						<tr className="border-muted-foreground border-b">
							<th scope="col" className="px-4 py-3 md:px-6 md:py-3">
								Engine
							</th>
							<th scope="col" className="px-4 py-3 md:px-6 md:py-3">
								Input Tokens
							</th>
							<th scope="col" className="px-4 py-3 md:px-6 md:py-3">
								Output Tokens
							</th>
							<th scope="col" className="px-4 py-3 md:px-6 md:py-3">
								Total Tokens
							</th>
						</tr>
					</thead>
					<tbody>
						<tr className="border-muted-foreground border-b">
							<td className="text-foreground px-4 py-4 font-medium whitespace-nowrap md:px-6">
								ChatGPT
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.chatgpt.inputTokens}
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.chatgpt.outputTokens}
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.chatgpt.totalTokens}
							</td>
						</tr>
						<tr className="border-muted-foreground border-b">
							<td className="text-foreground px-4 py-4 font-medium whitespace-nowrap md:px-6">
								Gemini
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.gemini.inputTokens}
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.gemini.outputTokens}
							</td>
							<td className="px-4 py-4 md:px-6">
								{tokenUsage.gemini.totalTokens}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<h2 className="text-xl font-bold">Disconnect Spotify</h2>
			<div className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					Removes your Spotify connection and deletes everything the app stores
					about you: account tokens, playlists, songs, generation progress and
					token usage. This happens immediately and cannot be undone.
				</p>
				<div className="flex justify-end">
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="destructive" disabled={isDeleting}>
								{isDeleting && (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Deleting...
									</>
								)}
								{!isDeleting && "Disconnect Spotify and delete my data"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									Disconnect Spotify and delete your data?
								</AlertDialogTitle>
								<AlertDialogDescription>
									Your playlists, songs and generation history in Music Gippity
									will be deleted permanently and you will be signed out.
									Playlists already saved to Spotify stay in your Spotify
									account.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									className={buttonVariants({ variant: "destructive" })}
									onClick={() => deleteAccount()}
								>
									Delete everything
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</Card>
	);
}
