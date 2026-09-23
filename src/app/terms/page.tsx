import type { Metadata } from "next";
import Link from "next/link";
import { PATH_PAGE } from "~/routes/paths";

export const metadata: Metadata = {
	title: "Terms of Use",
	description: "Terms of Use | Music Gippity",
};

const SPOTIFY_TERMS_URL = "https://www.spotify.com/legal/end-user-agreement/";
const ISSUES_URL = "https://github.com/r4iju/music-gippity/issues";

export default function TermsPage() {
	return (
		<article className="text-foreground container mx-auto flex max-w-screen-md flex-col gap-8 px-4 py-10">
			<header className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">Terms of Use</h1>
				<p className="text-muted-foreground text-sm">
					Last updated 23 September 2026
				</p>
				<p>
					Music Gippity is a free personal project. By using it you agree to the
					terms below.
				</p>
			</header>

			<Section title="Using the app">
				<ul className="list-disc space-y-2 pl-6">
					<li>
						You need a Spotify account. Signing in connects that account to the
						app.
					</li>
					<li>
						You must comply with{" "}
						<a
							href={SPOTIFY_TERMS_URL}
							target="_blank"
							rel="noreferrer noopener"
							className="underline"
						>
							Spotify&apos;s Terms of Use
						</a>{" "}
						while using the app. Spotify content is provided by Spotify; the app
						is not affiliated with, endorsed by or sponsored by Spotify AB.
					</li>
					<li>
						The app is for personal, non-commercial use. You may not sell,
						resell or otherwise commercially exploit data obtained through the
						app.
					</li>
				</ul>
			</Section>

			<Section title="AI-generated content">
				<p>
					Playlist suggestions come from an AI language model. They can be
					wrong, incomplete or fail to match your brief, and songs may be
					misattributed. Review what the app creates before relying on it.
				</p>
			</Section>

			<Section title="No warranty">
				<p>
					The app is provided &quot;as is&quot; without warranty of any kind. It
					may be changed, paused or discontinued at any time without notice. To
					the extent permitted by law, the operator is not liable for any loss
					arising from your use of the app.
				</p>
			</Section>

			<Section title="Your data">
				<p>
					How your data is handled is described in the{" "}
					<Link href={PATH_PAGE.privacy} className="underline">
						Privacy Policy
					</Link>
					. You can disconnect and delete your data at any time from Account
					settings.
				</p>
			</Section>

			<Section title="Contact">
				<p>
					Questions about these terms go to{" "}
					<a
						href={ISSUES_URL}
						target="_blank"
						rel="noreferrer noopener"
						className="underline"
					>
						GitHub issues
					</a>
					.
				</p>
			</Section>
		</article>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-xl font-semibold">{title}</h2>
			{children}
		</section>
	);
}
