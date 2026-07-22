import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createServerApiClient } from "@/lib/server-api";

import { PlatformProvidersClient } from "./platform-providers-client";

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<h1 className="text-3xl font-semibold tracking-tight">
					Admin Dashboard
				</h1>
				<p className="mt-2 text-base text-muted-foreground">
					Sign in to manage platform provider credentials
				</p>
				<Button asChild size="lg" className="mt-8 w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function PlatformProvidersPage() {
	const api = await createServerApiClient();
	const { data } = await api.GET("/admin/platform-providers");

	if (!data) {
		return <SignInPrompt />;
	}

	return <PlatformProvidersClient initialCredentials={data.credentials} />;
}
