import type { NextConfig } from "next";

import "./src/env.mjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withWorkflow } from "workflow/next";

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === "true",
});

const config: NextConfig = {
	reactStrictMode: true,
	reactCompiler: {
		compilationMode: "all",
		panicThreshold: "critical_errors",
	},
	turbopack: {},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "i.scdn.co",
				pathname: "/image/**",
			},
		],
	},
};
export default withWorkflow(withBundleAnalyzer(config));
