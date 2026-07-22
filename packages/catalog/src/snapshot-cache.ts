import type { EffectiveCatalog } from "./catalog.js";

export class CatalogUnavailableError extends Error {
	public constructor(cause?: unknown) {
		super("No current or bounded-stale catalog snapshot is available", {
			cause,
		});
		this.name = "CatalogUnavailableError";
	}
}

export interface CatalogSnapshotResult {
	snapshot: EffectiveCatalog;
	stale: boolean;
	loadedAt: number;
}

interface CatalogSnapshotCacheOptions {
	loadLatest: () => Promise<EffectiveCatalog | null>;
	now?: () => number;
	maxStaleMs: number;
}

export class CatalogSnapshotCache {
	private readonly loadLatest: () => Promise<EffectiveCatalog | null>;
	private readonly now: () => number;
	private readonly maxStaleMs: number;
	private cached: CatalogSnapshotResult | null = null;

	public constructor(options: CatalogSnapshotCacheOptions) {
		this.loadLatest = options.loadLatest;
		this.now = options.now ?? Date.now;
		this.maxStaleMs = options.maxStaleMs;
	}

	public async get(): Promise<CatalogSnapshotResult> {
		if (this.cached) {
			return this.cached;
		}
		return await this.refresh();
	}

	public async poll(): Promise<CatalogSnapshotResult> {
		return await this.refresh();
	}

	public async handleInvalidation(
		revision: number,
	): Promise<CatalogSnapshotResult> {
		if (this.cached && revision <= this.cached.snapshot.revision) {
			return this.cached;
		}
		return await this.refresh();
	}

	private async refresh(): Promise<CatalogSnapshotResult> {
		const now = this.now();
		try {
			const snapshot = await this.loadLatest();
			if (!snapshot) {
				throw new CatalogUnavailableError();
			}
			if (!this.cached || snapshot.revision >= this.cached.snapshot.revision) {
				this.cached = { snapshot, stale: false, loadedAt: now };
			}
			return this.cached;
		} catch (error) {
			if (this.cached && now - this.cached.loadedAt <= this.maxStaleMs) {
				return { ...this.cached, stale: true };
			}
			throw new CatalogUnavailableError(error);
		}
	}
}
