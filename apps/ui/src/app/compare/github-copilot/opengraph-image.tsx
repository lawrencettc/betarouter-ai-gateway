import { ImageResponse } from "next/og";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

// GitHub Copilot Icon
const GitHubCopilotIcon = () => (
	<svg
		fill="#ffffff"
		fillRule="evenodd"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		width={80}
		height={80}
	>
		<path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864m-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 0 0-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 0 0 .51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951m5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951M7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394m6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394M12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 0 1-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 0 0-.84-.044" />
	</svg>
);

// betarouter Icon
const BrandIcon = () => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 72 72"
		width={80}
		height={80}
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
);

export default async function CompareGitHubCopilotOgImage() {
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
						<span>Comparison</span>
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
					{/* Comparison icons */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 32,
						}}
					>
						{/* betarouter icon */}
						<div
							style={{
								width: 120,
								height: 120,
								borderRadius: 20,
								backgroundColor: "#1a1a1a",
								border: "2px solid rgba(59,130,246,0.5)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								padding: 16,
							}}
						>
							<BrandIcon />
						</div>

						{/* VS */}
						<span
							style={{
								fontSize: 40,
								fontWeight: 700,
								color: "#9CA3AF",
								letterSpacing: "0.05em",
							}}
						>
							VS
						</span>

						{/* GitHub Copilot icon */}
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
							<GitHubCopilotIcon />
						</div>
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
								fontSize: 64,
								fontWeight: 700,
								margin: 0,
								letterSpacing: "-0.03em",
								textAlign: "center",
								lineHeight: 1.1,
							}}
						>
							betarouter vs GitHub Copilot
						</h1>
						<p
							style={{
								fontSize: 28,
								color: "#9CA3AF",
								margin: 0,
								textAlign: "center",
								lineHeight: 1.3,
							}}
						>
							Zero token markup, hard budget caps, and 200+ models for any
							coding agent
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
