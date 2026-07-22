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
	refreshIntervalMs?: number;
}

export class CatalogSnapshotCache {
	private readonly loadLatest: () => Promise<EffectiveCatalog | null>;
	private readonly now: () => number;
	private readonly maxStaleMs: number;
	private readonly refreshIntervalMs: number;
	private cached: CatalogSnapshotResult | null = null;
	private refreshPromise: Promise<CatalogSnapshotResult> | null = null;

	public constructor(options: CatalogSnapshotCacheOptions) {
		this.loadLatest = options.loadLatest;
		this.now = options.now ?? Date.now;
		this.maxStaleMs = options.maxStaleMs;
		this.refreshIntervalMs = options.refreshIntervalMs ?? 10_000;
	}

	public async get(): Promise<CatalogSnapshotResult> {
		if (
			this.cached &&
			this.now() - this.cached.loadedAt < this.refreshIntervalMs
		) {
			return this.cached;
		}
		return await this.coalescedRefresh();
	}

	public async poll(): Promise<CatalogSnapshotResult> {
		return await this.coalescedRefresh();
	}

	public async handleInvalidation(
		revision: number,
	): Promise<CatalogSnapshotResult> {
		if (this.cached && revision <= this.cached.snapshot.revision) {
			return this.cached;
		}
		return await this.coalescedRefresh();
	}

	private async coalescedRefresh(): Promise<CatalogSnapshotResult> {
		this.refreshPromise ??= this.refresh().finally(() => {
			this.refreshPromise = null;
		});
		return await this.refreshPromise;
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
