import type { CSSProperties, ReactNode } from "react";

/**
 * Shared building blocks for the /compare OpenGraph images. Inline styles only,
 * so they render under next/og (Satori). Mirrors the look of the share OG image.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";
export const OG_BACKGROUND = "#09090b";
export const OG_GRADIENT =
	"radial-gradient(circle at 16% 12%, rgba(34,197,94,0.16), transparent 38%), radial-gradient(circle at 92% 88%, rgba(59,130,246,0.18), transparent 46%)";

export function LgMark({
	size = 56,
	color = "#e5e2e1",
}: {
	size?: number;
	color?: string;
}) {
	const height = size;
	return (
		<svg
			width={size}
			height={height}
			viewBox="0 0 72 72"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M14 20 L34 36 L14 52"
				stroke={color}
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
}

export function Pill({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}) {
	return (
		<span
			style={{
				display: "flex",
				alignItems: "center",
				padding: "9px 17px",
				borderRadius: 999,
				background: "rgba(255,255,255,0.07)",
				border: "1px solid rgba(255,255,255,0.12)",
				color: "#E5E7EB",
				fontSize: 18,
				fontWeight: 600,
				whiteSpace: "nowrap",
				...style,
			}}
		>
			{children}
		</span>
	);
}

export function clipText(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max - 1).trimEnd()}…`;
}
