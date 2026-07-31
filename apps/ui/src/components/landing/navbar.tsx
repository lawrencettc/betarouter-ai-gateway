"use client";

import {
	Activity,
	Blocks,
	BookOpen,
	Boxes,
	Building2,
	Calculator,
	ChevronDown,
	Clock,
	Code,
	GitCompare,
	Gift,
	KeyRound,
	LayoutGrid,
	Menu,
	MessagesSquare,
	Network,
	ScrollText,
	Shield,
	ShieldCheck,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { AuthLink } from "@/components/shared/auth-link";
import { ModelSearch } from "@/components/shared/model-search";
import { useSessionStatus } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "@/lib/components/navigation-menu";
import { useAppConfig } from "@/lib/config";
import Logo from "@/lib/icons/Logo";
import Wordmark from "@/lib/icons/Wordmark";
import { cn } from "@/lib/utils";

import { MARKETING_STATS } from "@betarouter/shared";

import { PromoBanner } from "./promo-banner";
import { ThemeToggle } from "./theme-toggle";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { Route } from "next";

function IconMenuItem({
	title,
	href,
	description,
	icon: IconComponent,
	gradient,
	external,
}: {
	title: string;
	href: string;
	description: string;
	icon: React.ElementType;
	gradient: string;
	external?: boolean;
}) {
	const posthog = usePostHog();
	const linkClassName = cn(
		// flex-row is load-bearing: NavigationMenuLink's base classes include
		// flex-col and are concatenated onto this link via Radix Slot, so the
		// direction must be asserted explicitly or the card stacks vertically.
		"group/product flex flex-row items-start gap-3 select-none rounded-lg p-3 no-underline outline-none transition-all duration-300 bg-linear-to-br from-transparent to-transparent",
		gradient,
		"hover:shadow-lg focus:shadow-md",
	);
	const iconColor = gradient.split(" ").slice(-2).join(" ");

	const inner = (
		<>
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/80 transition-colors">
				<IconComponent
					className={cn(
						"h-4 w-4 text-muted-foreground transition-colors",
						iconColor,
					)}
				/>
			</div>
			<div className="space-y-0.5">
				<div className="text-sm font-medium leading-none">{title}</div>
				<p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
					{description}
				</p>
			</div>
		</>
	);

	const handleClick = () => {
		posthog.capture("nav_link_clicked", { link: title, area: "dropdown" });
	};

	return (
		<li>
			<NavigationMenuLink asChild>
				{external ? (
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className={linkClassName}
						onClick={handleClick}
					>
						{inner}
					</a>
				) : (
					<Link
						href={href as Route}
						prefetch={true}
						className={linkClassName}
						onClick={handleClick}
					>
						{inner}
					</Link>
				)}
			</NavigationMenuLink>
		</li>
	);
}

export const Navbar = ({
	sticky = true,
	models,
	providers,
}: {
	sticky?: boolean;
	models?: ApiModel[];
	providers?: ApiProvider[];
}) => {
	const config = useAppConfig();
	const posthog = usePostHog();
	const { isAuthenticated: hasSession, isLoading } = useSessionStatus();
	const isAuthenticated = hasSession && !isLoading;

	const trackNav = (link: string) => {
		posthog.capture("nav_link_clicked", { link, area: "navbar" });
	};

	const productsLinks: Array<{
		title: string;
		href: string;
		description: string;
		icon: React.ElementType;
		gradient: string;
		external?: boolean;
	}> = [
		{
			title: "AI Gateway",
			href: "/products/ai-gateway",
			description: `Route requests to ${MARKETING_STATS.models} LLMs through a single, unified API endpoint.`,
			icon: Network,
			gradient:
				"hover:from-violet-500/20 hover:to-purple-600/30 hover:shadow-violet-500/10 group-hover/product:text-violet-500 dark:group-hover/product:text-violet-400",
		},
		{
			title: "BetaPass",
			href: "/products/devpass",
			description:
				"Fixed-price monthly plans for Claude Code, Cursor, and every coding tool.",
			icon: Code,
			gradient:
				"hover:from-indigo-500/20 hover:to-blue-600/30 hover:shadow-indigo-500/10 group-hover/product:text-indigo-500 dark:group-hover/product:text-indigo-400",
		},
		{
			title: "Playground",
			href: "/products/playground",
			description:
				"Every frontier model in one chat — plus image, video and audio studios.",
			icon: MessagesSquare,
			gradient:
				"hover:from-blue-500/20 hover:to-cyan-600/30 hover:shadow-blue-500/10 group-hover/product:text-blue-500 dark:group-hover/product:text-blue-400",
		},
		{
			title: "Observability",
			href: "/products/observability",
			description:
				"Monitor usage, costs, and latency with real-time analytics dashboards.",
			icon: Activity,
			gradient:
				"hover:from-emerald-500/20 hover:to-teal-600/30 hover:shadow-emerald-500/10 group-hover/product:text-emerald-500 dark:group-hover/product:text-emerald-400",
		},
	];

	const resourcesLinks: Array<{
		title: string;
		href: string;
		description: string;
		icon: React.ElementType;
		gradient: string;
		external?: boolean;
	}> = [
		{
			title: "Enterprise",
			href: "/enterprise",
			description:
				"Custom billing, extended retention, and priority support for teams.",
			icon: Building2,
			gradient:
				"hover:from-blue-500/20 hover:to-blue-600/30 hover:shadow-blue-500/10 group-hover/product:text-blue-500 dark:group-hover/product:text-blue-400",
		},
		{
			title: "Changelog",
			href: "/changelog",
			description: "What's new in betarouter across releases.",
			icon: ScrollText,
			gradient:
				"hover:from-violet-500/20 hover:to-purple-600/30 hover:shadow-violet-500/10 group-hover/product:text-violet-500 dark:group-hover/product:text-violet-400",
		},
		{
			title: "Documentation",
			href: config.docsUrl ?? "https://docs.betarouter.com",
			description: "API reference, feature guides, and integration docs.",
			icon: BookOpen,
			gradient:
				"hover:from-sky-500/20 hover:to-blue-600/30 hover:shadow-sky-500/10 group-hover/product:text-sky-500 dark:group-hover/product:text-sky-400",
			external: true,
		},
		{
			title: "Integrations",
			href: "/integrations",
			description:
				"Connect seamlessly with popular frameworks, SDKs, and tools.",
			icon: Blocks,
			gradient:
				"hover:from-indigo-500/20 hover:to-blue-600/30 hover:shadow-indigo-500/10 group-hover/product:text-indigo-500 dark:group-hover/product:text-indigo-400",
		},
		{
			title: "Reliability",
			href: "/reliability",
			description:
				"Automatic failover and 99.9999% effective uptime across providers.",
			icon: ShieldCheck,
			gradient:
				"hover:from-emerald-500/20 hover:to-teal-600/30 hover:shadow-emerald-500/10 group-hover/product:text-emerald-500 dark:group-hover/product:text-emerald-400",
		},
		{
			title: "Guardrails",
			href: "/features/guardrails",
			description:
				"Protect your AI with content moderation and safety filters.",
			icon: Shield,
			gradient:
				"hover:from-rose-500/20 hover:to-red-600/30 hover:shadow-rose-500/10 group-hover/product:text-rose-500 dark:group-hover/product:text-rose-400",
		},
		{
			title: "Providers",
			href: "/providers",
			description: "Connect and manage your provider API keys.",
			icon: KeyRound,
			gradient:
				"hover:from-cyan-500/20 hover:to-blue-600/30 hover:shadow-cyan-500/10 group-hover/product:text-cyan-500 dark:group-hover/product:text-cyan-400",
		},
		{
			title: "Apps",
			href: "/apps",
			description: "Browse apps and tools that work with betarouter.",
			icon: LayoutGrid,
			gradient:
				"hover:from-pink-500/20 hover:to-rose-600/30 hover:shadow-pink-500/10 group-hover/product:text-pink-500 dark:group-hover/product:text-pink-400",
		},
		{
			title: "Models",
			href: "/models",
			description: "Browse all available LLM models and capabilities.",
			icon: Boxes,
			gradient:
				"hover:from-purple-500/20 hover:to-fuchsia-600/30 hover:shadow-purple-500/10 group-hover/product:text-purple-500 dark:group-hover/product:text-purple-400",
		},
		{
			title: "Model Timeline",
			href: "/timeline",
			description: "Track the release history of all models.",
			icon: Clock,
			gradient:
				"hover:from-teal-500/20 hover:to-cyan-600/30 hover:shadow-teal-500/10 group-hover/product:text-teal-500 dark:group-hover/product:text-teal-400",
		},
		{
			title: "Compare",
			href: "/models/compare",
			description: "Compare models side by side.",
			icon: GitCompare,
			gradient:
				"hover:from-sky-500/20 hover:to-blue-600/30 hover:shadow-sky-500/10 group-hover/product:text-sky-500 dark:group-hover/product:text-sky-400",
		},
		{
			title: "Token Cost Calculator",
			href: "/token-cost-calculator",
			description: "Calculate your LLM token costs and savings instantly.",
			icon: Calculator,
			gradient:
				"hover:from-green-500/20 hover:to-emerald-600/30 hover:shadow-green-500/10 group-hover/product:text-green-500 dark:group-hover/product:text-green-400",
		},
		{
			title: "Referral Program",
			href: "/referrals",
			description: "Earn 1% of LLM spending.",
			icon: Gift,
			gradient:
				"hover:from-yellow-500/20 hover:to-amber-600/30 hover:shadow-yellow-500/10 group-hover/product:text-yellow-500 dark:group-hover/product:text-yellow-400",
		},
	];

	const mobileSections = [
		{
			label: "Products",
			items: productsLinks.map((i) => ({
				name: i.title,
				href: i.href,
				external: i.external,
			})),
		},
		{
			label: "Resources",
			items: resourcesLinks.map((i) => ({
				name: i.title,
				href: i.href,
				external: i.external,
			})),
		},
	];

	const [menuState, setMenuState] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);
	const [openMobileSection, setOpenMobileSection] = useState<string | null>(
		null,
	);

	useEffect(() => {
		const handleScroll = () => {
			setIsScrolled(window.scrollY > 50);
		};
		window.addEventListener("scroll", handleScroll);
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header>
			<nav
				data-state={menuState && "active"}
				className={cn("z-20 w-full px-2 group", sticky && "fixed")}
			>
				<PromoBanner collapsed={isScrolled} />
				<div
					className={cn(
						"mt-2 mx-auto max-w-[1400px] px-6 transition-all duration-300",
						isScrolled &&
							"bg-background/50 max-w-[1400px] rounded-2xl border backdrop-blur-lg lg:px-5",
					)}
				>
					<div className="relative flex flex-wrap items-center justify-between gap-6 py-3 nav:flex-nowrap nav:gap-0 nav:py-4">
						{/* Logo */}
						<div className="flex w-full justify-between nav:w-auto">
							<Link
								href="/"
								className="flex items-center space-x-2"
								prefetch={true}
							>
								<Logo className="h-8 w-8 rounded-full text-black dark:text-white" />
								<Wordmark className="text-xl whitespace-nowrap" />
							</Link>

							<button
								onClick={() => setMenuState(!menuState)}
								aria-label={menuState ? "Close Menu" : "Open Menu"}
								className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 nav:hidden"
							>
								<Menu className="group-data-[state=active]:scale-0 group-data-[state=active]:opacity-0 size-6 duration-200" />
								<X className="absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 group-data-[state=active]:rotate-0 group-data-[state=active]:scale-100 group-data-[state=active]:opacity-100 duration-200" />
							</button>
						</div>

						{/* Desktop center nav */}
						<div className="m-auto hidden items-center gap-1 nav:flex min-w-0">
							<div className="w-[140px] xl:w-[160px]">
								<ModelSearch models={models} providers={providers} />
							</div>
							<NavigationMenu viewport={false} delayDuration={300}>
								<NavigationMenuList className="flex gap-0.5 text-sm">
									{/* Most-clicked destinations surfaced as direct links —
									    DevPass (top product) and Models (top resource) per
									    PostHog page traffic; Chat joins on wider screens. */}
									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<a
												href="https://betapass.betarouter.com"
												onClick={() => trackNav("DevPass")}
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-3 py-2 whitespace-nowrap"
											>
												BetaPass
											</a>
										</NavigationMenuLink>
									</NavigationMenuItem>

									<NavigationMenuItem className="hidden min-[1360px]:block">
										<NavigationMenuLink asChild>
											<a
												href={config.playgroundUrl ?? "#"}
												onClick={() => trackNav("Chat")}
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-3 py-2 whitespace-nowrap"
											>
												Playground
											</a>
										</NavigationMenuLink>
									</NavigationMenuItem>

									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<Link
												href="/models"
												prefetch={true}
												onClick={() => trackNav("Models")}
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-3 py-2 whitespace-nowrap"
											>
												Models
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>

									{/* Products dropdown */}
									<NavigationMenuItem>
										<NavigationMenuTrigger className="text-muted-foreground hover:text-accent-foreground px-3 py-2 bg-transparent">
											Products
										</NavigationMenuTrigger>
										<NavigationMenuContent className="md:left-1/2 md:-translate-x-1/2">
											<ul className="grid grid-cols-2 gap-2 p-4 md:w-[520px] lg:w-[580px]">
												{productsLinks.map((product) => (
													<IconMenuItem
														key={product.title}
														title={product.title}
														href={product.href}
														description={product.description}
														icon={product.icon}
														gradient={product.gradient}
														external={product.external}
													/>
												))}
											</ul>
										</NavigationMenuContent>
									</NavigationMenuItem>

									{/* Resources dropdown */}
									<NavigationMenuItem>
										<NavigationMenuTrigger className="text-muted-foreground hover:text-accent-foreground px-3 py-2 bg-transparent">
											Resources
										</NavigationMenuTrigger>
										<NavigationMenuContent className="md:left-1/2 md:-translate-x-1/2">
											<ul className="grid grid-cols-2 gap-2 p-4 md:w-[680px] lg:w-[820px] lg:grid-cols-3">
												{resourcesLinks.map((link) => (
													<IconMenuItem
														key={link.title}
														title={link.title}
														href={link.href}
														description={link.description}
														icon={link.icon}
														gradient={link.gradient}
														external={link.external}
													/>
												))}
											</ul>
										</NavigationMenuContent>
									</NavigationMenuItem>

									{/* Pricing link */}
									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<Link
												href="/pricing"
												prefetch={true}
												onClick={() => trackNav("Pricing")}
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-3 py-2"
											>
												Pricing
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>
								</NavigationMenuList>
							</NavigationMenu>
						</div>

						{/* Right side */}
						<div className="bg-background group-data-[state=active]:block nav:group-data-[state=active]:flex mb-6 hidden max-h-[calc(100dvh-7rem)] w-full flex-wrap items-center justify-end space-y-6 overflow-y-auto overscroll-contain rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap nav:m-0 nav:flex nav:max-h-none nav:w-fit nav:shrink-0 nav:gap-3 nav:space-y-0 nav:overflow-visible nav:border-transparent nav:bg-transparent nav:p-0 nav:shadow-none dark:shadow-none dark:nav:bg-transparent">
							{/* Mobile nav */}
							<div className="nav:hidden">
								<div className="mb-4">
									<ModelSearch models={models} providers={providers} />
								</div>
								<ul className="text-base">
									<li>
										<a
											href="https://betapass.betarouter.com"
											onClick={() => trackNav("DevPass")}
											className="text-muted-foreground hover:text-accent-foreground block py-2.5 duration-150"
										>
											BetaPass
										</a>
									</li>
									<li>
										<a
											href={config.playgroundUrl ?? "#"}
											onClick={() => trackNav("Chat")}
											className="text-muted-foreground hover:text-accent-foreground block py-2.5 duration-150"
										>
											Playground
										</a>
									</li>
									<li>
										<Link
											href="/pricing"
											className="text-muted-foreground hover:text-accent-foreground block py-2.5 duration-150"
											prefetch={true}
										>
											Pricing
										</Link>
									</li>
									<li>
										<Link
											href="/models"
											className="text-muted-foreground hover:text-accent-foreground block py-2.5 duration-150"
											prefetch={true}
										>
											Models
										</Link>
									</li>

									{mobileSections.map((section) => (
										<li key={section.label}>
											<button
												type="button"
												onClick={() =>
													setOpenMobileSection(
														openMobileSection === section.label
															? null
															: section.label,
													)
												}
												className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
												aria-expanded={openMobileSection === section.label}
											>
												<span className="text-muted-foreground">
													{section.label}
												</span>
												<ChevronDown
													className={cn(
														"h-4 w-4 text-muted-foreground transition-transform duration-200",
														openMobileSection === section.label && "rotate-180",
													)}
												/>
											</button>
											<ul
												className={cn(
													"grid grid-cols-2 gap-x-4 rounded-xl bg-muted/40 px-3 py-2 mb-2",
													openMobileSection !== section.label && "hidden",
												)}
											>
												{section.items.map((item) => (
													<li key={item.name}>
														{item.external ? (
															<a
																href={item.href}
																target="_blank"
																rel="noopener noreferrer"
																className="text-muted-foreground hover:text-accent-foreground block py-2 duration-150 text-sm"
															>
																{item.name}
															</a>
														) : (
															<Link
																href={item.href as Route}
																className="text-muted-foreground hover:text-accent-foreground block py-2 duration-150 text-sm"
																prefetch={true}
															>
																{item.name}
															</Link>
														)}
													</li>
												))}
											</ul>
										</li>
									))}
								</ul>
							</div>

							<div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit items-center">
								<ThemeToggle />

								{isAuthenticated ? (
									<Button
										asChild
										className="bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-200 font-medium w-full md:w-fit"
									>
										<Link href="/dashboard" prefetch={true}>
											Dashboard
										</Link>
									</Button>
								) : (
									<>
										<Link
											href="/login"
											prefetch={true}
											className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden nav:block whitespace-nowrap"
										>
											Log In
										</Link>

										<Button
											asChild
											className="bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-200 font-medium w-full md:w-fit"
										>
											<AuthLink href="/signup">Get Started</AuthLink>
										</Button>
									</>
								)}
							</div>
						</div>
					</div>
				</div>
			</nav>
		</header>
	);
};
