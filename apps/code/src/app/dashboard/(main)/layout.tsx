import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

import DashboardShell from "@/app/dashboard/DashboardShell";
import { fetchServerData } from "@/lib/server-api";

import type { DevPlanStatus } from "@/app/dashboard/useDevPlanStatus";
import type { UserMe } from "@/hooks/useUser";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [userData, devPlanStatus] = await Promise.all([
		fetchServerData<UserMe>("GET", "/user/me"),
		fetchServerData<DevPlanStatus>("GET", "/dev-plans/status"),
	]);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard");
	}

	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			storageKey="theme"
		>
			<DashboardShell
				initialUser={userData}
				initialDevPlanStatus={devPlanStatus}
			>
				{children}
			</DashboardShell>
		</ThemeProvider>
	);
}
