"use client";

import { ArrowRight, Play } from "lucide-react";

import { useSessionStatus, useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";
import { getLoungeStudioPath, hasLoungeStudio } from "@/lib/model-utils";

export function ModelCtaButton({
	modelId,
	output,
	size = "default",
	className = "w-full gap-2 font-semibold group/cta",
	iconClassName = "h-4 w-4 transition-transform group-hover/cta:translate-x-0.5",
	onClick,
}: {
	modelId: string;
	output?: readonly string[] | null;
	size?: "default" | "sm";
	className?: string;
	iconClassName?: string;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const config = useAppConfig();
	const { isAuthenticated } = useSessionStatus();
	const { user, isLoading } = useUser({ enabled: isAuthenticated });
	const isLoggedIn = !!user && !isLoading;

	// Models without a playground studio (embeddings, rerank, transcription,
	// OCR, moderation) fall back to the "Get Started" CTA for logged-in users
	// too — a chat-playground deep link would land on a model it cannot serve.
	if (isLoggedIn && hasLoungeStudio(output)) {
		const studioPath = getLoungeStudioPath(output);
		return (
			<Button
				variant="default"
				size={size}
				className={className}
				onClick={onClick}
				asChild
			>
				<a
					href={`${config.playgroundUrl}${studioPath}?model=${encodeURIComponent(modelId)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Play className={iconClassName} />
					Try in Lounge
				</a>
			</Button>
		);
	}

	return (
		<Button
			variant="default"
			size={size}
			className={className}
			onClick={onClick}
			asChild
		>
			<a href={`${config.appUrl}/signup`}>
				Get Started
				<ArrowRight className={iconClassName} />
			</a>
		</Button>
	);
}
