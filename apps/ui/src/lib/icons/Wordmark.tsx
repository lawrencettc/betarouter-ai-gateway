export type WordmarkProps = React.HTMLAttributes<HTMLSpanElement>;

const Wordmark = ({ className, ...props }: WordmarkProps) => (
	<span
		{...props}
		className={className}
		style={{
			fontFamily: "var(--font-display), system-ui, sans-serif",
			fontWeight: 800,
			letterSpacing: "-0.02em",
			display: "inline-flex",
			alignItems: "baseline",
			lineHeight: 1,
		}}
	>
		<span style={{ color: "var(--muted-foreground, #8a938a)" }}>beta</span>
		<span
			style={{
				color: "#ffffff",
				background: "#004d2c",
				padding: "0 0.16em",
				marginLeft: "0.06em",
				borderRadius: 2,
			}}
		>
			router
		</span>
	</span>
);

export default Wordmark;
