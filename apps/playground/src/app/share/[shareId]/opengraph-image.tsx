import { ImageResponse } from "next/og";

import { getConfig } from "@/lib/config-server";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

interface SharedMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null;
	reasoning: string | null;
	tools: string | null;
	sequence: number;
	createdAt: string;
}

interface SharedChatResponse {
	share: {
		id: string;
		title: string;
		model: string;
		createdAt: string;
		messages: SharedMessage[];
	};
}

interface OgImageProps {
	params: Promise<{ shareId: string }>;
}

interface StoredImagePart {
	image_url?: {
		url?: string;
	};
}

interface SharePreview {
	title: string;
	prompt: string;
	response: string;
	model: string;
	imageUrl: string | null;
}

function flatten(text: string | null | undefined): string {
	if (!text) {
		return "";
	}
	return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

function pickPromptAndResponse(messages: SharedMessage[]): {
	prompt: string;
	response: string;
} {
	const userMessage = messages.find((m) => m.role === "user");
	const assistantMessage = messages.find((m) => m.role === "assistant");
	return {
		prompt: flatten(userMessage?.content),
		response: flatten(assistantMessage?.content),
	};
}

function isStoredImagePart(value: unknown): value is StoredImagePart {
	return (
		typeof value === "object" &&
		value !== null &&
		(!("image_url" in value) ||
			value.image_url === undefined ||
			(typeof value.image_url === "object" &&
				value.image_url !== null &&
				(!("url" in value.image_url) ||
					value.image_url.url === undefined ||
					typeof value.image_url.url === "string")))
	);
}

function extractImageUrl(images: string | null): string | null {
	if (!images) {
		return null;
	}

	try {
		const parsedImages = JSON.parse(images) as unknown;
		if (!Array.isArray(parsedImages)) {
			return null;
		}

		for (const image of parsedImages.filter(isStoredImagePart)) {
			const url = image.image_url?.url;
			if (url) {
				return url;
			}
		}
	} catch {
		return null;
	}

	return null;
}

function pickShareImage(messages: SharedMessage[]): string | null {
	const assistantImage = messages
		.filter((message) => message.role === "assistant")
		.map((message) => extractImageUrl(message.images))
		.find((url): url is string => Boolean(url));

	if (assistantImage) {
		return assistantImage;
	}

	return (
		messages
			.map((message) => extractImageUrl(message.images))
			.find((url): url is string => Boolean(url)) ?? null
	);
}

function getPreview(data: SharedChatResponse | null): SharePreview {
	const title = clip(flatten(data?.share.title) || "Shared chat", 72);
	const { prompt, response } = data
		? pickPromptAndResponse(data.share.messages)
		: { prompt: "", response: "" };
	const imageUrl = data ? pickShareImage(data.share.messages) : null;

	return {
		title,
		prompt: clip(prompt || title, imageUrl ? 112 : 136),
		response: clip(response, imageUrl ? 118 : 170),
		model: clip(flatten(data?.share.model), 34),
		imageUrl,
	};
}

function BrandHeader() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 16,
			}}
		>
			<svg
				width={52}
				height={52}
				viewBox="0 0 72 72"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M14 20 L34 36 L14 52"
					stroke="#e5e2e1"
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
			<div
				style={{
					display: "flex",
					flexDirection: "column",
				}}
			>
				<span
					style={{
						fontSize: 29,
						fontWeight: 700,
					}}
				>
					betarouter
				</span>
				<span
					style={{
						fontSize: 18,
						color: "#A1A1AA",
						letterSpacing: "0.02em",
					}}
				>
					Shared chat
				</span>
			</div>
		</div>
	);
}

function ModelBadge({ model }: { model: string }) {
	return model ? (
		<span
			style={{
				display: "flex",
				alignItems: "center",
				maxWidth: 360,
				padding: "8px 15px",
				borderRadius: 999,
				background: "rgba(255,255,255,0.07)",
				border: "1px solid rgba(255,255,255,0.1)",
				color: "#E5E7EB",
				fontSize: 18,
				fontFamily:
					"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
				overflow: "hidden",
				whiteSpace: "nowrap",
			}}
		>
			{model}
		</span>
	) : null;
}

function Footer({ model }: { model: string }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
				marginTop: 24,
			}}
		>
			<ModelBadge model={model} />
			<span
				style={{
					color: "#A1A1AA",
					fontSize: 21,
					fontWeight: 500,
				}}
			>
				chat.betarouter.com
			</span>
		</div>
	);
}

function TextPreview({ preview }: { preview: SharePreview }) {
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: "#09090b",
				backgroundImage:
					"radial-gradient(circle at 16% 12%, rgba(34,197,94,0.16), transparent 38%), radial-gradient(circle at 92% 88%, rgba(59,130,246,0.18), transparent 46%)",
				color: "white",
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 58,
				boxSizing: "border-box",
				overflow: "hidden",
			}}
		>
			<BrandHeader />
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 22,
					flex: 1,
					justifyContent: "center",
					minHeight: 0,
					marginTop: 24,
				}}
			>
				<span
					style={{
						fontSize: preview.prompt.length > 92 ? 45 : 52,
						fontWeight: 750,
						color: "#FAFAFA",
						lineHeight: 1.08,
						display: "flex",
						maxHeight: 174,
						overflow: "hidden",
						overflowWrap: "anywhere",
						wordBreak: "break-word",
					}}
				>
					{preview.prompt}
				</span>
				{preview.response ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							maxHeight: 160,
							overflow: "hidden",
							padding: "22px 26px",
							borderRadius: 18,
							background: "rgba(255,255,255,0.05)",
							border: "1px solid rgba(255,255,255,0.09)",
						}}
					>
						<span
							style={{
								fontSize: 13,
								color: "#A1A1AA",
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.12em",
								marginBottom: 10,
							}}
						>
							Response preview
						</span>
						<span
							style={{
								fontSize: 25,
								lineHeight: 1.32,
								color: "#E4E4E7",
								fontWeight: 400,
								display: "flex",
								overflow: "hidden",
								overflowWrap: "anywhere",
								wordBreak: "break-word",
							}}
						>
							{preview.response}
						</span>
					</div>
				) : null}
			</div>
			<Footer model={preview.model} />
		</div>
	);
}

function ImagePreview({ preview }: { preview: SharePreview }) {
	return (
		<div
			style={{
				width: 1200,
				height: 630,
				display: "flex",
				flexDirection: "column",
				background: "#09090b",
				backgroundImage:
					"radial-gradient(circle at 12% 10%, rgba(34,197,94,0.16), transparent 40%), radial-gradient(circle at 92% 82%, rgba(59,130,246,0.14), transparent 48%)",
				color: "white",
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 52,
				boxSizing: "border-box",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					width: "100%",
					marginBottom: 34,
				}}
			>
				<BrandHeader />
				<ModelBadge model={preview.model} />
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: "100%",
					marginBottom: 28,
				}}
			>
				<span
					style={{
						fontSize: preview.prompt.length > 84 ? 42 : 50,
						fontWeight: 750,
						lineHeight: 1.08,
						color: "#FAFAFA",
						display: "flex",
						height: 110,
						overflow: "hidden",
					}}
				>
					{preview.prompt}
				</span>
				{preview.response ? (
					<span
						style={{
							display: "flex",
							height: 36,
							overflow: "hidden",
							color: "#D4D4D8",
							fontSize: 24,
							lineHeight: 1.35,
							marginTop: 10,
						}}
					>
						{preview.response}
					</span>
				) : null}
			</div>
			<div
				style={{
					display: "flex",
					position: "relative",
					width: "100%",
					height: 284,
					overflow: "hidden",
				}}
			>
				<img
					src={preview.imageUrl ?? ""}
					alt=""
					style={{
						width: "100%",
						height: 568,
						objectFit: "cover",
						objectPosition: "center center",
					}}
				/>
				<div
					style={{
						position: "absolute",
						left: 0,
						bottom: 0,
						width: "100%",
						height: 172,
						display: "flex",
						background:
							"linear-gradient(to bottom, rgba(9,9,11,0), rgba(9,9,11,0.82) 72%, rgba(9,9,11,0.96))",
					}}
				/>
			</div>
			<span
				style={{
					display: "flex",
					justifyContent: "flex-end",
					color: "#A1A1AA",
					fontSize: 21,
					fontWeight: 500,
					marginTop: 20,
				}}
			>
				chat.betarouter.com
			</span>
		</div>
	);
}

export default async function ShareOgImage({ params }: OgImageProps) {
	try {
		const { shareId } = await params;
		const config = getConfig();
		const response = await fetch(
			`${config.apiBackendUrl}/public/chats/share/${shareId}`,
			{ cache: "no-store" },
		);

		const data = response.ok
			? ((await response.json()) as SharedChatResponse)
			: null;
		const preview = getPreview(data);

		return new ImageResponse(
			preview.imageUrl ? (
				<ImagePreview preview={preview} />
			) : (
				<TextPreview preview={preview} />
			),
			size,
		);
	} catch (error) {
		console.error("Error generating share OpenGraph image:", error);
		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "#0a0a0a",
						color: "white",
						fontSize: 48,
						fontWeight: 700,
						fontFamily:
							"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					}}
				>
					betarouter · Shared chat
				</div>
			),
			size,
		);
	}
}
