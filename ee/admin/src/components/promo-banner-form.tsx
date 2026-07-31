"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface PromoBannerData {
	enabled: boolean;
	brandName: string;
	discountPercent: number;
	message: string;
	linkPath: string;
	backgroundColor: string;
	textColor: string;
	endsAt: string;
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_BACKGROUND_COLOR = "#a8f399";
const DEFAULT_TEXT_COLOR = "#0c1a08";

interface PromoBannerFormProps {
	banner: PromoBannerData | null;
	onSubmit: (
		data: PromoBannerData,
	) => Promise<{ success: boolean; error?: string }>;
}

// Convert an ISO timestamp into the local "YYYY-MM-DDTHH:mm" format that
// <input type="datetime-local"> expects.
function toDatetimeLocal(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PromoBannerForm({ banner, onSubmit }: PromoBannerFormProps) {
	const router = useRouter();
	const [enabled, setEnabled] = useState(banner?.enabled ?? false);
	const [brandName, setBrandName] = useState(banner?.brandName ?? "");
	const [discountPercent, setDiscountPercent] = useState(
		String(banner?.discountPercent ?? 0),
	);
	const [message, setMessage] = useState(banner?.message ?? "");
	const [linkPath, setLinkPath] = useState(banner?.linkPath ?? "/providers/");
	const [backgroundColor, setBackgroundColor] = useState(
		banner?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
	);
	const [textColor, setTextColor] = useState(
		banner?.textColor ?? DEFAULT_TEXT_COLOR,
	);
	const [endsAt, setEndsAt] = useState(
		banner ? toDatetimeLocal(banner.endsAt) : "",
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSaved(false);

		const percent = Number(discountPercent);
		if (!brandName.trim()) {
			setError("Brand name is required");
			return;
		}
		if (
			!Number.isInteger(percent) ||
			percent < 0 ||
			percent > 100 ||
			discountPercent.trim() === ""
		) {
			setError("Discount must be a whole number between 0 and 100");
			return;
		}
		if (!message.trim()) {
			setError("Message is required");
			return;
		}
		if (!linkPath.startsWith("/")) {
			setError("Link path must be relative and start with /");
			return;
		}
		if (!HEX_COLOR_PATTERN.test(backgroundColor)) {
			setError("Background color must be a 6-digit hex value like #a8f399");
			return;
		}
		if (!HEX_COLOR_PATTERN.test(textColor)) {
			setError("Text color must be a 6-digit hex value like #0c1a08");
			return;
		}
		const endsAtDate = new Date(endsAt);
		if (!endsAt || Number.isNaN(endsAtDate.getTime())) {
			setError("A valid end date is required");
			return;
		}

		setIsSubmitting(true);
		try {
			const result = await onSubmit({
				enabled,
				brandName: brandName.trim(),
				discountPercent: percent,
				message: message.trim(),
				linkPath: linkPath.trim(),
				backgroundColor: backgroundColor.toLowerCase(),
				textColor: textColor.toLowerCase(),
				endsAt: endsAtDate.toISOString(),
			});

			if (!result.success) {
				setError(result.error ?? "Failed to save the promo banner");
				return;
			}

			setSaved(true);
			router.refresh();
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="flex max-w-2xl flex-col gap-6 rounded-lg border border-border/60 bg-card p-6"
		>
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-0.5">
					<Label htmlFor="promo-enabled">Banner enabled</Label>
					<p className="text-sm text-muted-foreground">
						When off, the banner is hidden everywhere regardless of the end
						date.
					</p>
				</div>
				<Switch
					id="promo-enabled"
					checked={enabled}
					onCheckedChange={setEnabled}
				/>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="promo-brand">Brand name</Label>
					<Input
						id="promo-brand"
						value={brandName}
						onChange={(e) => setBrandName(e.target.value)}
						placeholder="Runware"
					/>
					<p className="text-xs text-muted-foreground">
						Shown at the start of the banner. Brands with a known wordmark (e.g.
						Runware) render as their logo.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="promo-discount">Discount %</Label>
					<Input
						id="promo-discount"
						type="number"
						min={0}
						max={100}
						step={1}
						value={discountPercent}
						onChange={(e) => setDiscountPercent(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Set to 0 to hide the &quot;% off&quot; fragment.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="promo-message">Message</Label>
				<Input
					id="promo-message"
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					placeholder="open-source models"
				/>
				<p className="text-xs text-muted-foreground">
					Copy after the discount, e.g. &quot;is now on betarouter — 30% off{" "}
					<em>open-source models</em>&quot;.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="promo-link">Link path</Label>
					<Input
						id="promo-link"
						value={linkPath}
						onChange={(e) => setLinkPath(e.target.value)}
						placeholder="/providers/runware"
					/>
					<p className="text-xs text-muted-foreground">
						Relative to betarouter.com.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="promo-ends">Ends at</Label>
					<Input
						id="promo-ends"
						type="datetime-local"
						value={endsAt}
						onChange={(e) => setEndsAt(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						The banner hides itself automatically after this time (your local
						timezone).
					</p>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="promo-bg-color">Background color</Label>
					<div className="flex items-center gap-2">
						<input
							id="promo-bg-color"
							type="color"
							value={
								HEX_COLOR_PATTERN.test(backgroundColor)
									? backgroundColor
									: DEFAULT_BACKGROUND_COLOR
							}
							onChange={(e) => setBackgroundColor(e.target.value)}
							className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
						/>
						<Input
							value={backgroundColor}
							onChange={(e) => setBackgroundColor(e.target.value)}
							placeholder={DEFAULT_BACKGROUND_COLOR}
							className="font-mono"
						/>
					</div>
				</div>
				<div className="space-y-2">
					<Label htmlFor="promo-text-color">Text color</Label>
					<div className="flex items-center gap-2">
						<input
							id="promo-text-color"
							type="color"
							value={
								HEX_COLOR_PATTERN.test(textColor)
									? textColor
									: DEFAULT_TEXT_COLOR
							}
							onChange={(e) => setTextColor(e.target.value)}
							className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
						/>
						<Input
							value={textColor}
							onChange={(e) => setTextColor(e.target.value)}
							placeholder={DEFAULT_TEXT_COLOR}
							className="font-mono"
						/>
					</div>
				</div>
			</div>

			<div className="space-y-2">
				<Label>Preview</Label>
				<div
					className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-2xl px-4 py-2 text-[13px] font-medium leading-tight"
					style={{
						backgroundColor: HEX_COLOR_PATTERN.test(backgroundColor)
							? backgroundColor
							: DEFAULT_BACKGROUND_COLOR,
						color: HEX_COLOR_PATTERN.test(textColor)
							? textColor
							: DEFAULT_TEXT_COLOR,
					}}
				>
					<span className="font-semibold">{brandName || "Brand"}</span>
					<span>
						is now on betarouter —{" "}
						{Number(discountPercent) > 0 && (
							<span className="font-semibold">{discountPercent}% off </span>
						)}
						{message || "your message"}
					</span>
					<span
						className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums leading-tight"
						style={{
							backgroundColor: `${
								HEX_COLOR_PATTERN.test(textColor)
									? textColor
									: DEFAULT_TEXT_COLOR
							}1a`,
						}}
					>
						ends in 26d 12:00:00
					</span>
				</div>
			</div>

			{error && <p className="text-sm text-destructive">{error}</p>}
			{saved && !error && (
				<p className="text-sm text-muted-foreground">Saved.</p>
			)}

			<div>
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
					Save banner
				</Button>
			</div>
		</form>
	);
}
