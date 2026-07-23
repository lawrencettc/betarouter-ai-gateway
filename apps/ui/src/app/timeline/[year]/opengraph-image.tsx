import { ImageResponse } from "next/og";

import { models as modelDefinitions } from "@betarouter/models";

export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

export const alt = "AI model release timeline by year — betarouter";

interface ImageProps {
	params: Promise<{ year: string }>;
}

export default async function TimelineYearOgImage({ params }: ImageProps) {
	const { year } = await params;

	const count = modelDefinitions.filter((model) => {
		if (!("releasedAt" in model) || !model.releasedAt) {
			return false;
		}
		const date = new Date(model.releasedAt);
		return (
			!Number.isNaN(date.getTime()) && String(date.getUTCFullYear()) === year
		);
	}).length;

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					background: "#000000",
					backgroundImage:
						"radial-gradient(60% 70% at 50% 0%, rgba(56,189,248,0.18) 0%, rgba(0,0,0,0) 70%)",
					color: "white",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					padding: 64,
					boxSizing: "border-box",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 18,
					}}
				>
					<svg
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 72 72"
						width={56}
						height={56}
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
							fontSize: 30,
							color: "#9CA3AF",
						}}
					>
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							betarouter
						</span>
						<span style={{ opacity: 0.5 }}>•</span>
						<span>Release Timeline</span>
					</div>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 16,
						maxWidth: 980,
					}}
				>
					<h1
						style={{
							fontSize: 92,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							lineHeight: 1.02,
						}}
					>
						AI models released in {year}
					</h1>
					<p
						style={{
							fontSize: 32,
							margin: 0,
							color: "#9CA3AF",
							lineHeight: 1.3,
						}}
					>
						Provider release dates for every {year} LLM — and when each landed
						on betarouter.
					</p>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "flex-end",
						justifyContent: "space-between",
					}}
				>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={{ fontSize: 56, fontWeight: 700 }}>{count}</span>
						<span style={{ fontSize: 26, color: "#9CA3AF" }}>
							models released in {year}
						</span>
					</div>
					<span style={{ fontSize: 26, color: "#9CA3AF" }}>
						betarouter.com/timeline/{year}
					</span>
				</div>
			</div>
		),
		size,
	);
}
