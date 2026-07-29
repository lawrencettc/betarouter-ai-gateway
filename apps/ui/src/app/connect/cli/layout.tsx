import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Connect CLI",
	description:
		"Authorize a coding CLI (such as BetaPass Code) to access your betarouter account.",
	robots: { index: false, follow: false },
};

export default function ConnectCliLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
			<div className="w-full max-w-md">{children}</div>
		</div>
	);
}
