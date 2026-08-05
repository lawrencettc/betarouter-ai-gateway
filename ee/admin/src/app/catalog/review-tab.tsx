"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Eraser,
	Loader2,
	Pin,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi, useFetchClient } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type ReviewPage =
	paths["/admin/catalog/review"]["get"]["responses"]["200"]["content"]["application/json"];
type ReviewEntry = ReviewPage["items"][number];
type ChangeBody =
	paths["/admin/catalog/change-sets"]["post"]["requestBody"]["content"]["application/json"];
type Operation = ChangeBody["operations"][number];
type PatchOf<T extends Operation["type"]> =
	Extract<Operation, { type: T }> extends { patch: infer P } ? P : never;

type ReviewStatus = "open" | "resolved" | "all";
type ReviewKind = "all" | "override_drift" | "entity_added" | "entity_retired";

const KIND_LABELS: Record<Exclude<ReviewKind, "all">, string> = {
	override_drift: "Override drift",
	entity_added: "Upstream added",
	entity_retired: "Upstream retired",
};

function message(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return "The review request could not be completed";
}

function compactValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

/**
 * Upstream-change review queue (Phase 5 backend): open override-drift
 * entries resolve by keeping (re-set, which re-captures the base value) or
 * clearing the override — both staged as ordinary change-set operations —
 * while informational added/retired entries acknowledge in place.
 */
export function ReviewTab({
	active,
	onStageOperations,
}: {
	active: boolean;
	onStageOperations: (operations: Operation[]) => void;
}) {
	const api = useApi();
	const client = useFetchClient();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<ReviewStatus>("open");
	const [kind, setKind] = useState<ReviewKind>("all");
	const [page, setPage] = useState(1);
	const [busy, setBusy] = useState(false);

	const query = api.useQuery(
		"get",
		"/admin/catalog/review",
		{
			params: {
				query: {
					status,
					page,
					pageSize: 50,
					...(kind === "all" ? {} : { kind }),
				},
			},
		},
		{ enabled: active },
	);
	const data = query.data;
	const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

	const invalidate = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["get", "/admin/catalog/review"],
		});
	};

	const refresh = async () => {
		setBusy(true);
		try {
			const { data, error } = await client.POST(
				"/admin/catalog/review/refresh",
			);
			if (error || !data) {
				throw new Error(message(error));
			}
			toast.success(
				`Review reconciled: ${data.driftOpened} drift opened, ${data.openEntries} open`,
			);
			await invalidate();
		} catch (error) {
			toast.error(message(error));
		} finally {
			setBusy(false);
		}
	};

	const acknowledge = async (entry: ReviewEntry) => {
		setBusy(true);
		try {
			const result = await client.POST(
				"/admin/catalog/review/{id}/acknowledge",
				{
					params: { path: { id: entry.id } },
				},
			);
			if (result.error) {
				throw new Error(message(result.error));
			}
			toast.success(`Acknowledged ${entry.entryKey}`);
			await invalidate();
		} catch (error) {
			toast.error(message(error));
		} finally {
			setBusy(false);
		}
	};

	// Keep = re-set the CURRENT override value so its recorded base value is
	// re-captured from the moved mirror; clear = null out that field's
	// override. Both need the live policy updatedAt (and, for keep, the live
	// override value), so the target entity is re-fetched at click time.
	const stageDriftResolution = async (
		entry: ReviewEntry,
		action: "keep" | "clear",
	) => {
		if (!entry.field) {
			toast.error("Drift entry is missing its field");
			return;
		}
		setBusy(true);
		try {
			const listQuery = {
				params: {
					query: {
						state: "all" as const,
						search: entry.entityId,
						page: 1,
						pageSize: 500,
					},
				},
			};
			let item:
				| {
						id: string;
						policy: { updatedAt: string } | null;
						sourceOverrides: unknown;
				  }
				| undefined;
			if (entry.entityType === "provider") {
				const { data, error } = await client.GET(
					"/admin/catalog/providers",
					listQuery,
				);
				if (error || !data) {
					throw new Error(message(error));
				}
				item = data.items.find((row) => row.id === entry.entityId);
			} else if (entry.entityType === "model") {
				const { data, error } = await client.GET(
					"/admin/catalog/models",
					listQuery,
				);
				if (error || !data) {
					throw new Error(message(error));
				}
				item = data.items.find((row) => row.id === entry.entityId);
			} else {
				const { data, error } = await client.GET(
					"/admin/catalog/mappings",
					listQuery,
				);
				if (error || !data) {
					throw new Error(message(error));
				}
				item = data.items.find((row) => row.id === entry.entityId);
			}
			if (!item) {
				toast.error(`${entry.entityType} ${entry.entityId} no longer exists`);
				return;
			}
			const overrides = (item.sourceOverrides ?? null) as Record<
				string,
				{ value?: unknown }
			> | null;
			const currentOverride = overrides?.[entry.field];
			if (currentOverride === undefined) {
				toast.error(
					"The override was already cleared; refresh the review queue",
				);
				return;
			}
			const patchValue =
				action === "keep" ? (currentOverride.value ?? null) : null;
			if (action === "keep" && patchValue === null) {
				toast.error("The current override value could not be read");
				return;
			}
			const expectedUpdatedAt = item.policy?.updatedAt ?? null;
			const patch = { [entry.field]: patchValue };
			const operation: Operation =
				entry.entityType === "provider"
					? {
							version: 1,
							type: "provider.set_source_override",
							providerId: entry.entityId,
							expectedUpdatedAt,
							patch: patch as PatchOf<"provider.set_source_override">,
						}
					: entry.entityType === "model"
						? {
								version: 1,
								type: "model.set_source_override",
								modelId: entry.entityId,
								expectedUpdatedAt,
								patch: patch as PatchOf<"model.set_source_override">,
							}
						: {
								version: 1,
								type: "mapping.set_source_override",
								mappingId: entry.entityId,
								expectedUpdatedAt,
								patch: patch as PatchOf<"mapping.set_source_override">,
							};
			onStageOperations([operation]);
		} catch (error) {
			toast.error(message(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-xl border bg-card/95 p-3 sm:flex-row sm:flex-wrap sm:items-center">
				<div className="flex flex-wrap gap-2">
					{(Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>).map(
						(key) => (
							<Badge
								key={key}
								variant={
									(data?.openCounts[key] ?? 0) > 0 && key === "override_drift"
										? "destructive"
										: "secondary"
								}
							>
								{KIND_LABELS[key]}: {data?.openCounts[key] ?? 0} open
							</Badge>
						),
					)}
				</div>
				<div className="flex flex-1 flex-wrap justify-end gap-2">
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus(value as ReviewStatus);
							setPage(1);
						}}
					>
						<SelectTrigger className="w-32" aria-label="Filter review status">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="open">Open</SelectItem>
							<SelectItem value="resolved">Resolved</SelectItem>
							<SelectItem value="all">All</SelectItem>
						</SelectContent>
					</Select>
					<Select
						value={kind}
						onValueChange={(value) => {
							setKind(value as ReviewKind);
							setPage(1);
						}}
					>
						<SelectTrigger className="w-40" aria-label="Filter review kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All kinds</SelectItem>
							<SelectItem value="override_drift">Override drift</SelectItem>
							<SelectItem value="entity_added">Upstream added</SelectItem>
							<SelectItem value="entity_retired">Upstream retired</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => void refresh()}
					>
						<RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
						Reconcile now
					</Button>
				</div>
			</div>
			<div className="overflow-hidden rounded-xl border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Kind</TableHead>
							<TableHead>Entity</TableHead>
							<TableHead>Field / values</TableHead>
							<TableHead>Detected</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{(data?.items ?? []).map((entry) => (
							<TableRow key={entry.id}>
								<TableCell>
									<Badge
										variant={
											entry.kind === "override_drift" && entry.status === "open"
												? "destructive"
												: "outline"
										}
									>
										{KIND_LABELS[entry.kind]}
									</Badge>
								</TableCell>
								<TableCell>
									<div className="font-medium">{entry.entityId}</div>
									<div className="text-xs text-muted-foreground">
										{entry.entityType}
									</div>
								</TableCell>
								<TableCell>
									{entry.kind === "override_drift" ? (
										<div className="font-mono text-xs">
											<div className="font-semibold">{entry.field}</div>
											<div title={JSON.stringify(entry.overrideValue)}>
												override: {compactValue(entry.overrideValue)}
											</div>
											<div title={JSON.stringify(entry.baseValue)}>
												base: {compactValue(entry.baseValue)}
											</div>
											<div title={JSON.stringify(entry.mirrorValue)}>
												mirror: {compactValue(entry.mirrorValue)}
											</div>
										</div>
									) : (
										<span className="text-xs text-muted-foreground">
											{entry.kind === "entity_added"
												? "New upstream entity"
												: "Retired upstream"}
										</span>
									)}
								</TableCell>
								<TableCell className="text-xs">
									{new Date(entry.detectedAt).toLocaleString()}
								</TableCell>
								<TableCell>
									<Badge variant="outline">
										{entry.status === "open"
											? "open"
											: (entry.resolution ?? "resolved")}
									</Badge>
								</TableCell>
								<TableCell className="text-right">
									{entry.status === "open" &&
										entry.kind === "override_drift" && (
											<div className="flex justify-end gap-1">
												<Button
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() =>
														void stageDriftResolution(entry, "keep")
													}
													title="Re-set the override and re-capture the moved base value"
												>
													<Pin className="size-4" />
													Keep
												</Button>
												<Button
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() =>
														void stageDriftResolution(entry, "clear")
													}
													title="Clear this field's override and follow upstream"
												>
													<Eraser className="size-4" />
													Clear
												</Button>
											</div>
										)}
									{entry.status === "open" &&
										entry.kind !== "override_drift" && (
											<Button
												variant="ghost"
												size="sm"
												disabled={busy}
												onClick={() => void acknowledge(entry)}
											>
												<Check className="size-4" />
												Acknowledge
											</Button>
										)}
								</TableCell>
							</TableRow>
						))}
						{!query.isLoading && (data?.items.length ?? 0) === 0 && (
							<TableRow>
								<TableCell
									colSpan={6}
									className="h-32 text-center text-muted-foreground"
								>
									No review entries match this filter.
								</TableCell>
							</TableRow>
						)}
						{query.isLoading && (
							<TableRow>
								<TableCell colSpan={6} className="h-32 text-center">
									<Loader2 className="mx-auto size-5 animate-spin" />
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				<div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
					<span>
						{(data?.total ?? 0).toLocaleString()} total · page {page} of {pages}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage(page - 1)}
							aria-label="Previous review page"
						>
							<ChevronLeft className="size-4" />
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= pages}
							onClick={() => setPage(page + 1)}
							aria-label="Next review page"
						>
							<ChevronRight className="size-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
