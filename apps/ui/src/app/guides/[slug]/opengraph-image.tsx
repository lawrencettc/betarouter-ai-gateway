import { ImageResponse } from "next/og";

import { getIconForGuide } from "@/app/guides/og-icons";

import type { Guide } from "content-collections";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

export default async function GuideOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { allGuides } = await import("content-collections");
	const { slug } = await params;

	const guide = allGuides.find((guide: Guide) => guide.slug === slug);

	if (!guide) {
		return new ImageResponse(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					background: "#000000",
				}}
			/>,
			size,
		);
	}

	const Icon = getIconForGuide(guide.slug);

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
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
					<span style={{ color: "#ffffff", fontWeight: 600 }}>betarouter</span>
					<span style={{ opacity: 0.6 }}>•</span>
					<span>Guides</span>
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
					gap: 48,
				}}
			>
				{/* Integration icon */}
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
						padding: 16,
					}}
				>
					<Icon />
				</div>

				{/* Title and description */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 24,
						maxWidth: 1000,
					}}
				>
					<h1
						style={{
							fontSize: 80,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							textAlign: "center",
							lineHeight: 1.1,
						}}
					>
						{guide.title}
					</h1>
					<p
						style={{
							fontSize: 36,
							color: "#9CA3AF",
							margin: 0,
							textAlign: "center",
							lineHeight: 1.3,
						}}
					>
						{guide.description}
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
		</div>,
		size,
	);
}
