import { describe, expect, it } from "vitest";

import { calculateCatalogChecksum } from "./catalog.js";
import { parseStoredCatalogSnapshot } from "./runtime.js";

describe("parseStoredCatalogSnapshot", () => {
	it("accepts a valid stored snapshot and rejects a corrupted checksum", () => {
		const content = {
			providers: [],
			models: [],
			mappings: [],
			visibleProviderIds: [],
			visibleModelIds: [],
			availableModelIds: [],
			routableMappingIds: [],
		};
		const valid = {
			revision: 1,
			...content,
			checksum: calculateCatalogChecksum(content),
		};

		expect(parseStoredCatalogSnapshot(valid).revision).toBe(1);
		expect(() =>
			parseStoredCatalogSnapshot({ ...valid, checksum: "sha256:corrupt" }),
		).toThrow("checksum");
	});
});
