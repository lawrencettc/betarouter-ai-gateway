import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "betarouter — Production-ready AI app templates";

export default function Image() {
	return ogImage({
		eyebrow: "Templates",
		title: "Production-Ready AI Templates",
		subtitle:
			"Clone a starter, add your API key, and ship — chatbots, agents, RAG, and more.",
	});
}
