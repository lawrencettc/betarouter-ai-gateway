import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";

import { source } from "@/lib/source";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await params;
	const page = source.getPage(slug.slice(0, -1));
	if (!page) {
		notFound();
	}

	return generateOGImage({
		title: page.data.title,
		description: page.data.description,
		site: "betarouter",
		icon: (
			<svg
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 72 72"
				width={56}
				height={56}
			>
				<path
					d="M14 20 L34 36 L14 52"
					stroke="currentColor"
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
		),
	});
}

export function generateStaticParams() {
	return source.generateParams().map((page) => ({
		...page,
		slug: [...page.slug, "image.png"],
	}));
}
