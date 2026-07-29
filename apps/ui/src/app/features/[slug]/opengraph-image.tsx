import { ImageResponse } from "next/og";

import { getFeatureBySlug } from "@/lib/features";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

// Feature icons as SVGs (inline for ImageResponse compatibility)
const featureIcons: Record<string, () => React.JSX.Element> = {
	"unified-api-interface": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M4 17l6-6-6-6" />
			<path d="M12 19h8" />
		</svg>
	),
	"multi-provider-support": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<rect x="2" y="2" width="8" height="8" rx="2" />
			<rect x="14" y="2" width="8" height="8" rx="2" />
			<rect x="2" y="14" width="8" height="8" rx="2" />
			<rect x="14" y="14" width="8" height="8" rx="2" />
		</svg>
	),
	"performance-monitoring": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M3 3v18h18" />
			<path d="M18 17V9" />
			<path d="M13 17V5" />
			<path d="M8 17v-3" />
		</svg>
	),
	"secure-key-management": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
		</svg>
	),
	"cost-aware-analytics": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<line x1="12" y1="1" x2="12" y2="23" />
			<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
		</svg>
	),
	"per-model-provider-breakdown": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
			<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
			<ellipse cx="12" cy="5" rx="9" ry="3" />
		</svg>
	),
	"errors-reliability-monitoring": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M22 12h-4l-3 9L9 3l-3 9H2" />
		</svg>
	),
	"project-level-usage-explorer": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
			<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
		</svg>
	),
};

// Default icon for features without a specific icon
const DefaultIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		width={80}
		height={80}
	>
		<polygon points="12 2 2 7 12 12 22 7 12 2" />
		<polyline points="2 17 12 22 22 17" />
		<polyline points="2 12 12 17 22 12" />
	</svg>
);

function getIconForFeature(slug: string) {
	return featureIcons[slug] || DefaultIcon;
}

export default async function FeatureOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const feature = getFeatureBySlug(slug);

	if (!feature) {
		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						background: "#000000",
					}}
				/>
			),
			size,
		);
	}

	const Icon = getIconForFeature(feature.slug);

	return new ImageResponse(
		(
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
					padding: 60,
					boxSizing: "border-box",
				}}
			>
				{/* Header with logo */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 16,
					}}
				>
					<svg
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 72 72"
						width={48}
						height={48}
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
							gap: 8,
							fontSize: 24,
							color: "#9CA3AF",
						}}
					>
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							betarouter
						</span>
						<span style={{ opacity: 0.6 }}>•</span>
						<span>Features</span>
					</div>
				</div>

				{/* Main content */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						flex: 1,
						gap: 40,
					}}
				>
					{/* Feature icon */}
					<div
						style={{
							width: 120,
							height: 120,
							borderRadius: 20,
							backgroundColor: "#1a1a1a",
							border: "2px solid rgba(255,255,255,0.1)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#ffffff",
						}}
					>
						<Icon />
					</div>

					{/* Title and subtitle */}
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
								fontSize: 72,
								fontWeight: 700,
								margin: 0,
								letterSpacing: "-0.03em",
								textAlign: "center",
								lineHeight: 1.1,
							}}
						>
							{feature.title}
						</h1>
						<p
							style={{
								fontSize: 32,
								color: "#9CA3AF",
								margin: 0,
								textAlign: "center",
								lineHeight: 1.4,
							}}
						>
							{feature.subtitle}
						</p>
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						justifyContent: "flex-end",
						fontSize: 20,
						color: "#9CA3AF",
					}}
				>
					<span>betarouter.com</span>
				</div>
			</div>
		),
		size,
	);
}
