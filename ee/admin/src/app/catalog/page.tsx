import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createServerApiClient } from "@/lib/server-api";

import { CatalogClient } from "./catalog-client";

export default async function CatalogPage() {
	const api = await createServerApiClient();
	const [summary, providers, models, mappings, changes, credentials] =
		await Promise.all([
			api.GET("/admin/catalog/summary"),
			api.GET("/admin/catalog/providers", {
				params: { query: { page: 1, pageSize: 50, state: "all" } },
			}),
			api.GET("/admin/catalog/models", {
				params: { query: { page: 1, pageSize: 50, state: "all" } },
			}),
			api.GET("/admin/catalog/mappings", {
				params: { query: { page: 1, pageSize: 50, state: "all" } },
			}),
			api.GET("/admin/catalog/change-sets"),
			api.GET("/admin/platform-providers"),
		]);

	if (
		!summary.data ||
		!providers.data ||
		!models.data ||
		!mappings.data ||
		!changes.data
	) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center p-6">
				<div className="max-w-md text-center">
					<h1 className="text-2xl font-semibold">Catalog unavailable</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in with the platform administrator account or verify that the
						catalog API is healthy.
					</p>
					<Button asChild className="mt-6">
						<Link href="/login">Sign in</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<CatalogClient
			initialSummary={summary.data}
			initialProviders={providers.data}
			initialModels={models.data}
			initialMappings={mappings.data}
			initialChanges={changes.data}
			credentials={credentials.data?.credentials ?? []}
		/>
	);
}
