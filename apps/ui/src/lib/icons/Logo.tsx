export type LogoProps = React.HTMLAttributes<SVGElement>;

const Logo = (props: LogoProps) => (
	<svg
		fill="none"
		{...props}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 72 72"
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
);

export default Logo;
