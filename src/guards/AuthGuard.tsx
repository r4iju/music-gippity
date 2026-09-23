"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import { PATH_AUTH } from "~/routes/paths";

type Props = {
	children: React.ReactNode;
};

/**
 * Users need to login before they can access the dashboard,
 * so this guard will redirect them to the login page if they
 * are not logged in.
 */
export default function AuthGuard({ children }: Props) {
	const { data: session, status } = useSession();
	const router = useRouter();

	useEffect(() => {
		if (status === "loading") return;

		if (status === "unauthenticated") {
			router.push(PATH_AUTH.login);
			return;
		}

		// biome-ignore lint/suspicious/noExplicitAny: Casting to any to access custom error property
		if ((session as any)?.error === "RefreshAccessTokenError") {
			void signOut({ callbackUrl: PATH_AUTH.login });
		}
	}, [status, session, router]);

	if (
		status === "loading" ||
		status === "unauthenticated" ||
		// biome-ignore lint/suspicious/noExplicitAny: Casting to any to access custom error property
		(session as any)?.error === "RefreshAccessTokenError"
	) {
		return null;
	}

	return <>{children}</>;
}
