import Link from "next/link";
import { forwardRef } from "react";

export interface LogoProps {
	disabledLink?: boolean;
	className?: string;
}

const Logo = forwardRef<HTMLDivElement, LogoProps>(
	({ disabledLink = false, className = "" }, ref) => {
		// SVG logo code
		const logo = (
			<div ref={ref} className={`inline-flex h-10 w-10 ${className}`}>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					// width="100%"
					// height="100%"
					viewBox="0 0 512 512"
				>
					<title>Logo</title>
					<path d="M21.055,3.018l-6.474,1.386C13.659,4.601,13,5.416,13,6.359v11.354c0,1.949-6,0.32-6,5.766c0,1,0.602,3.52,3.466,3.52 C13.986,27,15,24.324,15,21.354c0-1.271,0-11.816,0-11.816l6.08-1.334C21.617,8.086,22,7.61,22,7.059V3.782 C22,3.284,21.541,2.913,21.055,3.018z"></path>
				</svg>
			</div>
		);

		if (disabledLink) {
			return logo;
		}

		return <Link href="/">{logo}</Link>;
	},
);

Logo.displayName = "Logo";

export default Logo;
