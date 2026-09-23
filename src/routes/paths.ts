function path(root: string, sublink: string) {
	return `${root}${sublink}`;
}

const ROOTS_DASHBOARD = "/dashboard";

export const PATH_DASHBOARD = {
	root: ROOTS_DASHBOARD,
	profile: path(ROOTS_DASHBOARD, "profile"),
	playlists: path(ROOTS_DASHBOARD, "/create-playlist"),
};

const ROOTS_AUTH = "/auth";

export const PATH_AUTH = {
	root: ROOTS_AUTH,
	login: path(ROOTS_AUTH, "/login"),
};

export const PATH_PAGE = {
	privacy: "/privacy",
	terms: "/terms",
};
