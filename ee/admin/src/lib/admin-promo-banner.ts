"use server";

import { createServerApiClient } from "./server-api";

export async function getPromoBanner() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/promo-banner");
	return data ?? null;
}

export async function updatePromoBanner(body: {
	enabled: boolean;
	brandName: string;
	discountPercent: number;
	message: string;
	linkPath: string;
	endsAt: string;
}) {
	const $api = await createServerApiClient();
	const { data } = await $api.PUT("/admin/promo-banner", { body });
	return data ?? null;
}
