import { redirect } from "next/navigation";
import { PATH_DASHBOARD } from "~/routes/paths";
import { auth } from "~/server/auth";

type Props = {
	children: React.ReactNode;
};

/**
 * Users don't need to login twice, so this guard will redirect
 * them to the dashboard if they are already logged in.
 */
export default async function GuestGuard({ children }: Props) {
	const session = await auth();
	if (session) redirect(PATH_DASHBOARD.root);
	return <>{children}</>;
}
