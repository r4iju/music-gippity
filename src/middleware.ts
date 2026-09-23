import { type NextRequest, NextResponse } from "next/server";

export default function middleware(request: NextRequest) {
	const pathname = new URL(request.url).pathname;

	const requestHeaders = new Headers(request.headers);

	requestHeaders.set("x-pathname", pathname);
	return NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
}

export const config = {
	// dont match static files and public folder
	matcher:
		"/((?!api|.well-known/workflow|_next/static|_next/image|favicon.ico).*)",
};
