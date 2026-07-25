import { ImageResponse } from "next/og";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

function parseDiscount(value: string): number {
	const parsed = Number(value);
	if (isNaN(parsed) || parsed < 1 || parsed > 99) {
		return 20;
	}
	return Math.round(parsed);
}

export default async function NanoBananaSimulatorOgImage({
	params,
}: {
	params: Promise<{ discount: string }>;
}) {
	const { discount: raw } = await params;
	const discount = parseDiscount(raw);

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
					<span>Cost Simulator</span>
				</div>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					flex: 1,
					gap: 32,
				}}
			>
				<h1
					style={{
						fontSize: 64,
						fontWeight: 700,
						margin: 0,
						letterSpacing: "-0.02em",
						textAlign: "center",
					}}
				>
					Nano Banana Pro
				</h1>

				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 24,
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							backgroundColor: "#1a1a1a",
							border: "2px solid rgba(255,255,255,0.15)",
							borderRadius: 20,
							padding: "24px 48px",
							gap: 4,
						}}
					>
						<span style={{ fontSize: 20, color: "#9CA3AF" }}>
							Google AI Studio
						</span>
						<span style={{ fontSize: 48, fontWeight: 700 }}>Full Price</span>
					</div>

					<span
						style={{
							fontSize: 40,
							color: "#9CA3AF",
							fontWeight: 700,
						}}
					>
						vs
					</span>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							backgroundColor: "rgba(22, 163, 74, 0.15)",
							border: "2px solid rgba(22, 163, 74, 0.4)",
							borderRadius: 20,
							padding: "24px 48px",
							gap: 4,
						}}
					>
						<span style={{ fontSize: 20, color: "#9CA3AF" }}>betarouter</span>
						<span
							style={{
								fontSize: 48,
								fontWeight: 700,
								color: "#4ade80",
							}}
						>
							{discount}% Off
						</span>
					</div>
				</div>

				<p
					style={{
						fontSize: 24,
						color: "#9CA3AF",
						margin: 0,
						textAlign: "center",
					}}
				>
					Save on Gemini 3 Pro image generation
				</p>
			</div>

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
