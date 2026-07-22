import { describe, expect, it, vi } from "vitest";

import {
	CatalogSnapshotCache,
	CatalogUnavailableError,
} from "./snapshot-cache.js";

function snapshot(revision: number) {
	return {
		revision,
		checksum: `sha256:${revision}`,
		providers: [],
		models: [],
		mappings: [],
		visibleProviderIds: [],
		visibleModelIds: [],
		availableModelIds: [],
		routableMappingIds: [],
	};
}

describe("CatalogSnapshotCache", () => {
	it("self-heals a missed invalidation by polling the revision", async () => {
		let current = snapshot(1);
		const loadLatest = vi.fn(async () => current);
		const cache = new CatalogSnapshotCache({
			loadLatest,
			now: () => 1_000,
			maxStaleMs: 5_000,
		});

		expect((await cache.get()).snapshot.revision).toBe(1);
		current = snapshot(2);
		expect((await cache.poll()).snapshot.revision).toBe(2);
		expect(loadLatest).toHaveBeenCalledTimes(2);
	});

	it("serves a bounded stale snapshot when the database is unavailable", async () => {
		let now = 1_000;
		let fail = false;
		const cache = new CatalogSnapshotCache({
			loadLatest: async () => {
				if (fail) {
					throw new Error("database unavailable");
				}
				return snapshot(4);
			},
			now: () => now,
			maxStaleMs: 5_000,
		});

		await cache.get();
		fail = true;
		now = 5_999;
		const result = await cache.poll();

		expect(result.stale).toBe(true);
		expect(result.snapshot.revision).toBe(4);
	});

	it("fails closed when no bounded-stale snapshot exists", async () => {
		let now = 1_000;
		let fail = false;
		const cache = new CatalogSnapshotCache({
			loadLatest: async () => {
				if (fail) {
					throw new Error("database unavailable");
				}
				return snapshot(7);
			},
			now: () => now,
			maxStaleMs: 5_000,
		});

		await cache.get();
		fail = true;
		now = 6_001;

		await expect(cache.poll()).rejects.toBeInstanceOf(CatalogUnavailableError);
	});

	it("self-heals a missed event after the refresh interval", async () => {
		let now = 1_000;
		let current = snapshot(1);
		const cache = new CatalogSnapshotCache({
			loadLatest: async () => current,
			now: () => now,
			maxStaleMs: 60_000,
			refreshIntervalMs: 10_000,
		});

		expect((await cache.get()).snapshot.revision).toBe(1);
		current = snapshot(2);
		now += 9_999;
		expect((await cache.get()).snapshot.revision).toBe(1);
		now += 1;
		expect((await cache.get()).snapshot.revision).toBe(2);
	});

	it("coalesces concurrent refreshes", async () => {
		let resolveLoad!: (value: ReturnType<typeof snapshot>) => void;
		let loads = 0;
		const cache = new CatalogSnapshotCache({
			loadLatest: async () => {
				loads += 1;
				return await new Promise<ReturnType<typeof snapshot>>((resolve) => {
					resolveLoad = resolve;
				});
			},
			maxStaleMs: 60_000,
		});

		const first = cache.get();
		const second = cache.get();
		resolveLoad(snapshot(3));
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(loads).toBe(1);
	});
});
