import { ImageResponse } from "next/og";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@betarouter/models";

export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

export const alt = "LLM Release Timeline — When Each AI Model Was Released";

export default async function TimelineOgImage() {
	const totalModels = modelDefinitions.length;
	const totalProviders = providerDefinitions.filter(
		(p) => p.name !== "betarouter",
	).length;

	const roundedModels = Math.floor(totalModels / 10) * 10;
	const roundedProviders = Math.floor(totalProviders / 5) * 5;

	const stats = [
		{ value: `${roundedModels}+`, label: "models" },
		{ value: `${roundedProviders}+`, label: "providers" },
		{ value: "48h", label: "to add new models" },
	];

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
						gap: 20,
						maxWidth: 980,
					}}
				>
					<h1
						style={{
							fontSize: 76,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							lineHeight: 1.05,
						}}
					>
						When every LLM was released
					</h1>
					<p
						style={{
							fontSize: 32,
							margin: 0,
							color: "#9CA3AF",
							lineHeight: 1.3,
						}}
					>
						Provider release dates for GPT, Claude, Gemini, Llama, Mistral &
						DeepSeek — and when each landed on betarouter.
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
					<div style={{ display: "flex", flexDirection: "row", gap: 40 }}>
						{stats.map((stat) => (
							<div
								key={stat.label}
								style={{ display: "flex", flexDirection: "column", gap: 4 }}
							>
								<span style={{ fontSize: 52, fontWeight: 700 }}>
									{stat.value}
								</span>
								<span style={{ fontSize: 24, color: "#9CA3AF" }}>
									{stat.label}
								</span>
							</div>
						))}
					</div>
					<span style={{ fontSize: 26, color: "#9CA3AF" }}>
						betarouter.com/timeline
					</span>
				</div>
			</div>
		),
		size,
	);
}
