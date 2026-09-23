import type { Metadata } from "next";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import AccountGeneral from "./account-general";

export const metadata: Metadata = {
	title: "Account Settings",
	description: "Account Settings | Music Gippity",
};

// ----------------------------------------------------------------------

export default async function UserAccountPage() {
	const session = await auth();
	const tokenUsage = await api.account.getTokenUsage();
	return (
		<div className="container mx-auto flex h-full max-w-screen-md items-center justify-center">
			{/* biome-ignore lint/style/noNonNullAssertion: Guaranteed by middleware */}
			<AccountGeneral user={session!.user} tokenUsage={tokenUsage} />
		</div>
	);
}
