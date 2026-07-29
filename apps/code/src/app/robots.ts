import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/dashboard/", "/login", "/signup", "/api/"],
			},
		],
		sitemap: "https://betapass.betarouter.com/sitemap.xml",
	};
}
