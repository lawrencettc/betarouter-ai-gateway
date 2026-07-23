"use client";

import { ThemeProvider } from "next-themes";

import type { ReactNode } from "react";

export function DashboardThemeProvider({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			storageKey="theme"
		>
			{children}
		</ThemeProvider>
	);
}
