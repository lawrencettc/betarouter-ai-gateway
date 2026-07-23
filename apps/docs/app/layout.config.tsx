import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
	themeSwitch: {
		enabled: false,
	},
	nav: {
		url: "/",
		title: (
			<>
				<svg
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 72 72"
					className="h-6 w-6"
				>
					<path
						d="M14 20 L34 36 L14 52"
						stroke="currentColor"
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
				<span
					style={{
						fontFamily: "var(--font-bricolage), system-ui, sans-serif",
						fontWeight: 800,
						letterSpacing: "-0.02em",
					}}
				>
					<span style={{ opacity: 0.6 }}>beta</span>
					<span
						style={{
							color: "#fff",
							background: "#004d2c",
							padding: "0 0.16em",
							borderRadius: 2,
						}}
					>
						router
					</span>
				</span>
			</>
		),
	},
	githubUrl: "https://github.com/theopenco/llmgateway",
	links: [
		{
			text: "Dashboard",
			url: "https://betarouter.com/dashboard",
			active: "none",
		},
	],
};
