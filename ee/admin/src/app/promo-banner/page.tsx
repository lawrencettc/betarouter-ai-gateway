import { Megaphone } from "lucide-react";
import Link from "next/link";

import {
	PromoBannerForm,
	type PromoBannerData,
} from "@/components/promo-banner-form";
import { Button } from "@/components/ui/button";
import { getPromoBanner, updatePromoBanner } from "@/lib/admin-promo-banner";

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function PromoBannerPage() {
	const bannerData = await getPromoBanner();

	if (bannerData === null) {
		return <SignInPrompt />;
	}

	async function handleUpdatePromoBanner(
		data: PromoBannerData,
	): Promise<{ success: boolean; error?: string }> {
		"use server";

		try {
			const result = await updatePromoBanner(data);

			if (!result) {
				return { success: false, error: "Failed to save the promo banner" };
			}

			return { success: true };
		} catch (error) {
			console.error("Error saving promo banner:", error);
			return {
				success: false,
				error: "An error occurred while saving the promo banner",
			};
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Megaphone className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Promo Banner
							</h1>
							<p className="text-sm text-muted-foreground">
								Marketing banner shown above the landing navbar and on the Code
								app
							</p>
						</div>
					</div>
				</div>
			</header>

			<PromoBannerForm
				banner={bannerData.banner}
				onSubmit={handleUpdatePromoBanner}
			/>

			<div className="max-w-2xl rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How the promo banner works</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>
						The banner appears above the navbar on betarouter.com landing pages
						and at the top of the Code app
					</li>
					<li>
						It renders as: brand — &quot;is now on betarouter — X% off
						&lt;message&gt;&quot; with a live countdown to the end date
					</li>
					<li>
						It hides automatically once the end date passes, and instantly when
						disabled here (frontends refresh the config within about a minute)
					</li>
					<li>
						This banner is marketing copy only — actual pricing discounts are
						configured separately on the Discounts page
					</li>
				</ul>
			</div>
		</div>
	);
}
