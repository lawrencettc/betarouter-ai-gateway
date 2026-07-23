"use client";

import { IntegrationGuidesGrid } from "@betarouter/shared/components";

export function GuidesGrid({ uiUrl }: { uiUrl: string }) {
	return <IntegrationGuidesGrid internalHrefPrefix={uiUrl} />;
}
