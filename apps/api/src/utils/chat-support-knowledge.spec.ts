import { describe, expect, test } from "vitest";

import { isAllowedKnowledgeUrl } from "./chat-support-knowledge.js";

describe("isAllowedKnowledgeUrl", () => {
	test("allows the product domains over https", () => {
		expect(isAllowedKnowledgeUrl("https://betarouter.com/quick-start")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://docs.betarouter.com/v1_models")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://betapass.betarouter.com/")).toBe(true);
		expect(isAllowedKnowledgeUrl("https://chat.betarouter.com/")).toBe(true);
	});

	test("rejects other hosts", () => {
		expect(isAllowedKnowledgeUrl("https://evil.com/")).toBe(false);
		expect(isAllowedKnowledgeUrl("https://betarouter.com.evil.com/")).toBe(
			false,
		);
		expect(isAllowedKnowledgeUrl("https://notbetarouter.com/")).toBe(false);
	});

	test("rejects non-https schemes", () => {
		expect(isAllowedKnowledgeUrl("http://betarouter.com/")).toBe(false);
		expect(isAllowedKnowledgeUrl("file:///etc/passwd@betarouter.com")).toBe(
			false,
		);
	});

	test("rejects malformed urls", () => {
		expect(isAllowedKnowledgeUrl("not a url")).toBe(false);
		expect(isAllowedKnowledgeUrl("")).toBe(false);
	});
});
