import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { db } from "@betarouter/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Public, unauthenticated promo banner configuration. The landing pages
 * (apps/ui) and the Code app render the banner from this endpoint; the admin
 * dashboard manages it via the /admin/promo-banner routes.
 */
export const publicPromoBanner = new OpenAPIHono<ServerTypes>();

const publicPromoBannerSchema = z.object({
	brandName: z.string(),
	discountPercent: z.number(),
	message: z.string(),
	linkPath: z.string(),
	backgroundColor: z.string(),
	textColor: z.string(),
	endsAt: z.string(),
});

const getPromoBanner = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						banner: publicPromoBannerSchema.nullable(),
					}),
				},
			},
			description: "The active promo banner, or null when none is running.",
		},
	},
});

publicPromoBanner.openapi(getPromoBanner, async (c) => {
	const banner = await db.query.promoBanner.findFirst();

	if (!banner || !banner.enabled || banner.endsAt.getTime() <= Date.now()) {
		return c.json({ banner: null });
	}

	return c.json({
		banner: {
			brandName: banner.brandName,
			discountPercent: banner.discountPercent,
			message: banner.message,
			linkPath: banner.linkPath,
			backgroundColor: banner.backgroundColor,
			textColor: banner.textColor,
			endsAt: banner.endsAt.toISOString(),
		},
	});
});

export default publicPromoBanner;
