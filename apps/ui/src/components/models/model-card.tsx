"use client";

import { ModelCtaButton } from "@/components/models/model-cta-button";

import { ModelCard as SharedModelCard } from "@betarouter/shared/components";

import type { ComponentProps } from "react";

export { ProviderSection } from "@betarouter/shared/components";

type SharedModelCardProps = ComponentProps<typeof SharedModelCard>;

export function ModelCard(props: Omit<SharedModelCardProps, "renderCta">) {
	return (
		<SharedModelCard
			{...props}
			renderCta={(args) => <ModelCtaButton {...args} />}
		/>
	);
}
