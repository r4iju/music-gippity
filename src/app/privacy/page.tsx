import type { Metadata } from "next";
import Link from "next/link";
import { PATH_DASHBOARD, PATH_PAGE } from "~/routes/paths";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description: "Privacy Policy | Music Gippity",
};

const ISSUES_URL = "https://github.com/r4iju/music-gippity/issues";
const SPOTIFY_APPS_URL = "https://www.spotify.com/account/apps/";

export default function PrivacyPage() {
	return (
		<article className="text-foreground container mx-auto flex max-w-screen-md flex-col gap-8 px-4 py-10">
			<header className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">Privacy Policy</h1>
				<p className="text-muted-foreground text-sm">
					Last updated 23 September 2026
				</p>
				<p>
					Music Gippity is a free personal project. This page explains, in plain
					language, what the app does with your data. If anything here is
					unclear, open an issue on{" "}
					<ExternalLink href={ISSUES_URL}>GitHub</ExternalLink>.
				</p>
			</header>

			<Section title="What the app does">
				<p>
					Music Gippity turns a short text brief into a Spotify playlist. An AI
					language model (OpenAI or Google Gemini, whichever you choose)
					proposes artist and song names from your brief alone. The app then
					looks those names up on Spotify and creates the playlist in your
					Spotify account.
				</p>
			</Section>

			<Section title="Spotify data we access, and why">
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>Profile</strong> (Spotify id, display name, email, avatar):
						used to sign you in and show who is logged in.
					</li>
					<li>
						<strong>Playlist permissions</strong>: used to create and modify the
						playlists you generate here.
					</li>
					<li>
						<strong>Top tracks, saved tracks and recently played tracks</strong>
						: read only, to mark songs you already know in the app&apos;s own
						interface and to keep a discovery-oriented playlist from repeating
						them.
					</li>
				</ul>
				<p>
					Your Spotify data, meaning your listening history, your library and
					Spotify catalogue metadata, is never sent to any AI model, never used
					to train or fine-tune a model, and never sold or shared with
					advertisers.
				</p>
			</Section>

			<Section title="What is sent to third parties">
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>AI provider (OpenAI or Google)</strong>: your brief text and
						the settings you chose (for example mood, track count and genres)
						are sent to the provider you selected so it can generate
						suggestions. No Spotify data is included.
					</li>
					<li>
						<strong>Music databases</strong>: the artist and song names proposed
						by the AI (not your Spotify data) are looked up on MusicBrainz,
						Last.fm, Deezer, lrclib and ListenBrainz to verify that the
						recordings exist and to gather release facts such as year and album.
						Recording identifiers (ISRC) may be used as lookup keys against
						those databases.
					</li>
				</ul>
			</Section>

			<Section title="What we store">
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Your Spotify account tokens, so the app can act on your behalf when
						creating playlists.
					</li>
					<li>The playlists and songs you created in the app.</li>
					<li>
						Progress data for playlist generations, so an interrupted generation
						can be resumed.
					</li>
					<li>
						Aggregate AI token counts per provider, shown on your account page.
					</li>
				</ul>
				<p>
					Everything is stored until you disconnect. We do not keep copies of
					your listening history or library.
				</p>
			</Section>

			<Section title="Disconnect and deletion">
				<p>
					The <strong>Disconnect Spotify and delete my data</strong> button in{" "}
					<Link href={PATH_DASHBOARD.root} className="underline">
						Account settings
					</Link>{" "}
					deletes everything listed above immediately and signs you out. You can
					also revoke the app&apos;s access in your{" "}
					<ExternalLink href={SPOTIFY_APPS_URL}>
						Spotify account settings
					</ExternalLink>
					.
				</p>
				<p>
					Deletion requests sent through{" "}
					<ExternalLink href={ISSUES_URL}>GitHub issues</ExternalLink> are
					honoured within 5 days.
				</p>
			</Section>

			<Section title="Attribution">
				<p>
					Spotify content and metadata are provided by Spotify. Music Gippity is
					not affiliated with, endorsed by or sponsored by Spotify AB.
				</p>
			</Section>

			<footer className="text-muted-foreground text-sm">
				See also the{" "}
				<Link href={PATH_PAGE.terms} className="underline">
					Terms of Use
				</Link>
				.
			</footer>
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

function ExternalLink({
	href,
	children,
}: {
	href: string;
	children: React.ReactNode;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="underline"
		>
			{children}
		</a>
	);
}
