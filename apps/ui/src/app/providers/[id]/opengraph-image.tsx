import { ImageResponse } from "next/og";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@betarouter/models";
import {
	AWSBedrockIconStatic,
	FireworksIconStatic,
	getProviderIcon,
	GoogleStudioAIIconStatic,
	MinimaxIconStatic,
	XAIIconStatic,
} from "@betarouter/shared/components";

export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

interface ImageProps {
	params: Promise<{ id: string }>;
}

export default async function ProviderOgImage({ params }: ImageProps) {
	try {
		const { id } = await params;
		const decodedId = decodeURIComponent(id);

		const provider = providerDefinitions.find((p) => p.id === decodedId);

		if (!provider || provider.name === "betarouter") {
			return new ImageResponse(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "#000000",
						color: "white",
						fontSize: 48,
						fontWeight: 700,
						fontFamily:
							"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					}}
				>
					Provider Not Found
				</div>,
				size,
			);
		}

		const ProviderIcon =
			provider.id === "minimax"
				? MinimaxIconStatic
				: provider.id === "aws-bedrock"
					? AWSBedrockIconStatic
					: provider.id === "google-ai-studio"
						? GoogleStudioAIIconStatic
						: provider.id === "xai"
							? XAIIconStatic
							: provider.id === "fireworks"
								? FireworksIconStatic
								: getProviderIcon(provider.id);

		// Count how many models this provider offers
		const supportedModels = modelDefinitions.filter((model) =>
			model.providers.some((p) => p.providerId === provider.id),
		);
		const totalModels = supportedModels.length;

		return new ImageResponse(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					alignItems: "stretch",
					background: "#000000",
					color: "white",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					padding: 56,
					boxSizing: "border-box",
				}}
			>
				{/* Header with logo */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 20,
					}}
				>
					<svg
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 72 72"
						width={64}
						height={64}
					>
						<path
							d="M14 20 L34 36 L14 52"
							stroke="#e5e2e1"
							strokeWidth={8}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M38 20 L58 36 L38 52"
							stroke="#08A84E"
							strokeWidth={8}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 12,
							fontSize: 32,
							color: "#9CA3AF",
						}}
					>
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							betarouter
						</span>
						<span style={{ opacity: 0.6 }}>•</span>
						<span>Provider</span>
					</div>
				</div>

				{/* Main content - centered */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						flex: 1,
						gap: 28,
					}}
				>
					{/* Provider icon */}
					<div
						style={{
							width: 160,
							height: 160,
							borderRadius: 32,
							backgroundColor: "#1a1a1a",
							border: "3px solid rgba(255,255,255,0.15)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#ffffff",
						}}
					>
						{ProviderIcon ? (
							<ProviderIcon width={96} height={96} />
						) : (
							<span
								style={{
									fontSize: 72,
									fontWeight: 700,
								}}
							>
								{provider.name.charAt(0).toUpperCase()}
							</span>
						)}
					</div>

					{/* Provider name and info */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 20,
							maxWidth: 1000,
						}}
					>
						<h1
							style={{
								fontSize: 96,
								fontWeight: 700,
								margin: 0,
								letterSpacing: "-0.03em",
								textAlign: "center",
								lineHeight: 1.1,
							}}
						>
							{provider.name}
						</h1>

						{/* Model count badge */}
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 12,
								backgroundColor: "#1a1a1a",
								border: "2px solid rgba(255,255,255,0.15)",
								borderRadius: 999,
								padding: "16px 36px",
							}}
						>
							<span
								style={{
									fontSize: 40,
									fontWeight: 700,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{totalModels}
							</span>
							<span
								style={{
									fontSize: 36,
									color: "#9CA3AF",
								}}
							>
								{totalModels === 1 ? "model" : "models"} available
							</span>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: 28,
						color: "#9CA3AF",
					}}
				>
					<span style={{ opacity: 0.6 }}>{provider.id}</span>
					<span>betarouter.com</span>
				</div>
			</div>,
			size,
		);
	} catch {
		// Fallback image in case of errors
		return new ImageResponse(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "#000000",
					color: "white",
					fontSize: 40,
					fontWeight: 700,
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				}}
			>
				betarouter Provider
			</div>,
			size,
		);
	}
}
