"use client";

import { ArrowUpRight } from "lucide-react";

import { useApi } from "@/lib/fetch-client";

import {
	formatCountdown,
	RunwareWordmarkIcon,
	useCountdown,
} from "@betarouter/shared/components";

// Sentinel passed to useCountdown while no banner is loaded so the hook can
// stay unconditional; it reads as expired, which keeps the banner hidden.
const EXPIRED = "1970-01-01T00:00:00Z";

export function PromoBanner() {
	const api = useApi();
	const { data } = api.useQuery("get", "/public/promo-banner", {});
	const banner = data?.banner ?? null;
	const countdown = useCountdown(banner?.endsAt ?? EXPIRED);

	if (!banner || countdown.expired) {
		return null;
	}

	return (
		<a
			href={`https://betarouter.com${banner.linkPath}`}
			target="_blank"
			rel="noopener noreferrer"
			className="group block bg-[#a8f399] text-[#0c1a08]"
		>
			<div className="container mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2 text-[13px] font-medium leading-tight">
				{banner.brandName.toLowerCase() === "runware" ? (
					<RunwareWordmarkIcon
						className="h-2.5 w-auto shrink-0"
						aria-label="Runware"
						role="img"
					/>
				) : (
					<span className="font-semibold">{banner.brandName}</span>
				)}
				<span>
					<span className="hidden sm:inline">is now on betarouter — </span>
					{banner.discountPercent > 0 && (
						<>
							<span className="font-semibold">
								{banner.discountPercent}% off
							</span>{" "}
						</>
					)}
					{banner.message}
				</span>
				<span
					suppressHydrationWarning
					className="rounded bg-[#0c1a08]/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
				>
					ends in {formatCountdown(countdown)}
				</span>
				<ArrowUpRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
			</div>
		</a>
	);
}
