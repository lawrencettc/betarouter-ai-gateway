"use client";

import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Loader2,
	Pencil,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	TestTube2,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFetchClient } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type Summary =
	paths["/admin/catalog/summary"]["get"]["responses"]["200"]["content"]["application/json"];
type ProviderPage =
	paths["/admin/catalog/providers"]["get"]["responses"]["200"]["content"]["application/json"];
type ModelPage =
	paths["/admin/catalog/models"]["get"]["responses"]["200"]["content"]["application/json"];
type MappingPage =
	paths["/admin/catalog/mappings"]["get"]["responses"]["200"]["content"]["application/json"];
type Change =
	paths["/admin/catalog/change-sets"]["get"]["responses"]["200"]["content"]["application/json"][number];
type ChangeBody =
	paths["/admin/catalog/change-sets"]["post"]["requestBody"]["content"]["application/json"];
type Operation = ChangeBody["operations"][number];
type MappingPolicyOperation = Extract<
	Operation,
	{ type: "mapping.set_policy" }
>;
type DisabledCapability = NonNullable<
	MappingPolicyOperation["patch"]["disabledCapabilities"]
>[number];
const disabledCapabilityValues = new Set<DisabledCapability>([
	"streaming",
	"vision",
	"audio",
	"document",
	"reasoning",
	"tools",
	"jsonOutput",
	"webSearch",
	"embeddings",
	"imageGenerations",
	"videoGenerations",
	"speechGenerations",
	"ocr",
	"supportsResponsesApi",
]);

function isDisabledCapability(value: string): value is DisabledCapability {
	return disabledCapabilityValues.has(value as DisabledCapability);
}
type Preview =
	paths["/admin/catalog/change-sets/preview"]["post"]["responses"]["200"]["content"]["application/json"];
type RollbackPreview =
	paths["/admin/catalog/change-sets/{id}/rollback/preview"]["post"]["responses"]["200"]["content"]["application/json"];
type Credential =
	paths["/admin/platform-providers"]["get"]["responses"]["200"]["content"]["application/json"]["credentials"][number];
type ProviderItem = ProviderPage["items"][number];
type ModelItem = ModelPage["items"][number];
type MappingItem = MappingPage["items"][number];
type Entity =
	| { kind: "provider"; item: ProviderItem }
	| { kind: "model"; item: ModelItem }
	| { kind: "mapping"; item: MappingItem };
type ListState =
	| "all"
	| "visible"
	| "hidden"
	| "available"
	| "unavailable"
	| "deprecated"
	| "retired"
	| "unhealthy"
	| "unpriced"
	| "uncredentialed"
	| "untested";

function message(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return "The catalog request could not be completed";
}

function healthBadge(ok: boolean, good: string, bad: string) {
	return (
		<Badge variant={ok ? "default" : "secondary"}>
			{ok ? (
				<CheckCircle2 className="size-3" />
			) : (
				<XCircle className="size-3" />
			)}
			{ok ? good : bad}
		</Badge>
	);
}

function StateFilter({
	value,
	onChange,
}: {
	value: ListState;
	onChange: (value: ListState) => void;
}) {
	return (
		<Select value={value} onValueChange={(next) => onChange(next as ListState)}>
			<SelectTrigger className="w-44" aria-label="Filter catalog state">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All states</SelectItem>
				<SelectItem value="visible">Visible</SelectItem>
				<SelectItem value="hidden">Hidden</SelectItem>
				<SelectItem value="available">Available</SelectItem>
				<SelectItem value="unavailable">Unavailable</SelectItem>
				<SelectItem value="deprecated">Deprecated</SelectItem>
				<SelectItem value="retired">Retired</SelectItem>
				<SelectItem value="unhealthy">Unhealthy</SelectItem>
				<SelectItem value="unpriced">Unpriced</SelectItem>
				<SelectItem value="uncredentialed">No credential</SelectItem>
				<SelectItem value="untested">Untested</SelectItem>
			</SelectContent>
		</Select>
	);
}

function Pager({
	page,
	pageSize,
	total,
	onPage,
}: {
	page: number;
	pageSize: number;
	total: number;
	onPage: (page: number) => void;
}) {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	return (
		<div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
			<span>
				{total.toLocaleString()} total · page {page} of {pages}
			</span>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={page <= 1}
					onClick={() => onPage(page - 1)}
					aria-label="Previous page"
				>
					<ChevronLeft className="size-4" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={page >= pages}
					onClick={() => onPage(page + 1)}
					aria-label="Next page"
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function PriceSummary({ item }: { item: MappingItem }) {
	const input = item.customerPrices.input;
	const output = item.customerPrices.output;
	if (!input && !output) {
		return <span className="text-destructive">Missing</span>;
	}
	return (
		<span className="font-mono text-xs">
			{item.pricingMode ?? "—"}
			<br />
			{input ? `$${input}/M in` : ""}
			{output ? ` · $${output}/M out` : ""}
		</span>
	);
}

function PreviewSheet({
	open,
	onOpenChange,
	operations,
	revision,
	onPublished,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	operations: Operation[];
	revision: number;
	onPublished: () => Promise<void>;
}) {
	const api = useFetchClient();
	const [title, setTitle] = useState("Update catalog policy");
	const [reason, setReason] = useState("");
	const [effectiveAt, setEffectiveAt] = useState("");
	const [preview, setPreview] = useState<Preview | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState("");
	const [idempotencyKey, setIdempotencyKey] = useState(() =>
		crypto.randomUUID(),
	);

	useEffect(() => {
		if (open) {
			setIdempotencyKey(crypto.randomUUID());
		} else {
			setPreview(null);
			setConfirm("");
		}
	}, [open]);

	const body = (): ChangeBody => ({
		title,
		reason,
		baseRevision: revision || null,
		effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
		idempotencyKey,
		operations,
	});
	const confirmPhrase = `APPLY ${operations.length}`;

	const runPreview = async () => {
		if (!reason.trim()) {
			toast.error("Add an operational reason");
			return;
		}
		setBusy(true);
		try {
			const { data, error } = await api.POST(
				"/admin/catalog/change-sets/preview",
				{ body: body() },
			);
			if (error || !data) {
				throw new Error(message(error));
			}
			setPreview(data);
		} catch (error) {
			toast.error(message(error));
		} finally {
			setBusy(false);
		}
	};

	const publish = async () => {
		if (!preview?.valid || confirm !== confirmPhrase) {
			return;
		}
		setBusy(true);
		try {
			const { data, error } = await api.POST("/admin/catalog/change-sets", {
				body: body(),
			});
			if (error || !data) {
				throw new Error(message(error));
			}
			const changeSetId = (data as { id?: string }).id;
			if (!effectiveAt) {
				if (!changeSetId) {
					throw new Error("The saved change set did not return an ID");
				}
				const applied = await api.POST(
					"/admin/catalog/change-sets/{id}/apply",
					{ params: { path: { id: changeSetId } } },
				);
				if (applied.error) {
					throw new Error(message(applied.error));
				}
				toast.success(
					`Catalog revision ${applied.data?.catalogRevision ?? ""} published`,
				);
			} else {
				toast.success("Catalog change scheduled");
			}
			onOpenChange(false);
			await onPublished();
		} catch (error) {
			toast.error(message(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
				<SheetHeader>
					<SheetTitle>Preview catalog change</SheetTitle>
					<SheetDescription>
						{operations.length} atomic operation
						{operations.length === 1 ? "" : "s"} against revision {revision}.
					</SheetDescription>
				</SheetHeader>
				<div className="space-y-4 px-4">
					<div className="space-y-2">
						<Label htmlFor="change-title">Title</Label>
						<Input
							id="change-title"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="change-reason">Reason</Label>
						<Textarea
							id="change-reason"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							placeholder="Why is this safe and necessary?"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="effective-at">
							Schedule (optional, local time)
						</Label>
						<Input
							id="effective-at"
							type="datetime-local"
							value={effectiveAt}
							onChange={(event) => setEffectiveAt(event.target.value)}
						/>
					</div>
					<Button
						onClick={runPreview}
						disabled={busy || operations.length === 0}
						className="w-full"
					>
						{busy && <Loader2 className="size-4 animate-spin" />} Validate and
						calculate impact
					</Button>
					{preview && (
						<div className="space-y-3">
							<Alert variant={preview.valid ? "default" : "destructive"}>
								<AlertTitle>
									{preview.valid ? "Ready to publish" : "Blocked"}
								</AlertTitle>
								<AlertDescription>
									{preview.blockers.length
										? preview.blockers
												.map(
													(item) =>
														`${item.entityId}: ${item.reasons.join(", ")}`,
												)
												.join(" · ")
										: "No activation blockers found."}
								</AlertDescription>
							</Alert>
							<div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
								{Object.entries(preview.affected).map(([key, value]) => (
									<div key={key} className="rounded-lg border p-3">
										<div className="text-muted-foreground capitalize">
											{key}
										</div>
										<div className="text-xl font-semibold">
											{value ?? "Unknown"}
										</div>
									</div>
								))}
							</div>
							{(preview.stateChanges.length > 0 ||
								preview.priceChanges.length > 0 ||
								preview.fallbackLosses.length > 0 ||
								preview.marginEstimate) && (
								<div className="space-y-3 rounded-lg border p-3 text-sm">
									{preview.stateChanges.length > 0 && (
										<div>
											<div className="font-medium">State changes</div>
											<ul className="list-disc pl-5 text-muted-foreground">
												{preview.stateChanges.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										</div>
									)}
									{preview.priceChanges.length > 0 && (
										<div>
											<div className="font-medium">Customer price changes</div>
											<ul className="list-disc pl-5 font-mono text-xs text-muted-foreground">
												{preview.priceChanges.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										</div>
									)}
									{preview.marginEstimate && (
										<p>
											<span className="font-medium">Margin estimate:</span>{" "}
											{preview.marginEstimate}
										</p>
									)}
									{preview.fallbackLosses.length > 0 && (
										<p className="text-destructive">
											Models losing fallback coverage:{" "}
											{preview.fallbackLosses.join(", ")}
										</p>
									)}
								</div>
							)}
							{preview.warnings.length > 0 && (
								<Alert>
									<AlertTriangle className="size-4" />
									<AlertTitle>Warnings</AlertTitle>
									<AlertDescription>
										{preview.warnings.join(" · ")}
									</AlertDescription>
								</Alert>
							)}
							<div className="space-y-2">
								<Label htmlFor="apply-confirm">
									Type {confirmPhrase} to {effectiveAt ? "schedule" : "publish"}
								</Label>
								<Input
									id="apply-confirm"
									value={confirm}
									onChange={(event) => setConfirm(event.target.value)}
									autoComplete="off"
								/>
							</div>
						</div>
					)}
				</div>
				<SheetFooter>
					<Button
						onClick={publish}
						disabled={!preview?.valid || confirm !== confirmPhrase || busy}
					>
						{busy && <Loader2 className="size-4 animate-spin" />}
						{effectiveAt ? "Schedule change" : "Publish now"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function EditEntityDialog({
	entity,
	open,
	onOpenChange,
	onOperations,
}: {
	entity: Entity | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOperations: (operations: Operation[]) => void;
}) {
	const [visible, setVisible] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const [allowDirect, setAllowDirect] = useState(false);
	const [lifecycle, setLifecycle] = useState<
		"draft" | "active" | "deprecated" | "retired"
	>("draft");
	const [replacement, setReplacement] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [description, setDescription] = useState("");
	const [website, setWebsite] = useState("");
	const [aliases, setAliases] = useState("");
	const [sortOrder, setSortOrder] = useState("1000");
	const [deprecatedAt, setDeprecatedAt] = useState("");
	const [retireAt, setRetireAt] = useState("");
	const [retirementMessage, setRetirementMessage] = useState("");
	const [externalId, setExternalId] = useState("");
	const [priority, setPriority] = useState("100");
	const [weight, setWeight] = useState("100");
	const [breakerEnabled, setBreakerEnabled] = useState(true);
	const [contextSizeLimit, setContextSizeLimit] = useState("");
	const [maxOutputLimit, setMaxOutputLimit] = useState("");
	const [disabledCapabilities, setDisabledCapabilities] = useState("");
	const [priceMode, setPriceMode] = useState<
		"source_cost" | "markup" | "fixed"
	>("source_cost");
	const [markup, setMarkup] = useState("2000");
	const [fixedPricesJson, setFixedPricesJson] = useState(
		'{\n  "version": 1\n}',
	);

	useEffect(() => {
		if (!entity) {
			return;
		}
		if (entity.kind === "provider") {
			setVisible(entity.item.policy?.visible ?? false);
			setEnabled(entity.item.policy?.enabled ?? false);
			setLifecycle(entity.item.policy?.lifecycle ?? "draft");
			setDisplayName(entity.item.policy?.displayNameOverride ?? "");
			setDescription(entity.item.policy?.descriptionOverride ?? "");
			setWebsite(entity.item.policy?.websiteOverride ?? "");
			setSortOrder(String(entity.item.policy?.sortOrder ?? 1000));
			setDeprecatedAt(entity.item.policy?.deprecatedAt?.slice(0, 16) ?? "");
			setRetireAt(entity.item.policy?.retireAt?.slice(0, 16) ?? "");
			setReplacement(entity.item.policy?.replacementProviderId ?? "");
		} else if (entity.kind === "model") {
			setVisible(entity.item.policy?.visible ?? false);
			setEnabled(entity.item.policy?.enabled ?? false);
			setAllowDirect(entity.item.policy?.allowDirect ?? false);
			setLifecycle(entity.item.policy?.lifecycle ?? "draft");
			setReplacement(entity.item.policy?.replacementModelId ?? "");
			setRetireAt(entity.item.policy?.retireAt?.slice(0, 16) ?? "");
			setDeprecatedAt(entity.item.policy?.deprecatedAt?.slice(0, 16) ?? "");
			setDisplayName(entity.item.policy?.displayNameOverride ?? "");
			setDescription(entity.item.policy?.descriptionOverride ?? "");
			setAliases(entity.item.policy?.aliasesOverride?.join(", ") ?? "");
			setSortOrder(String(entity.item.policy?.sortOrder ?? 1000));
			setRetirementMessage(entity.item.policy?.retirementMessage ?? "");
		} else {
			setEnabled(entity.item.policy?.enabled ?? false);
			setExternalId(
				entity.item.policy?.externalIdOverride ?? entity.item.externalId,
			);
			setPriority(String(entity.item.policy?.priority ?? entity.item.priority));
			setWeight(String(entity.item.policy?.weight ?? entity.item.weight));
			setBreakerEnabled(entity.item.policy?.breakerEnabled ?? true);
			setContextSizeLimit(String(entity.item.policy?.contextSizeLimit ?? ""));
			setMaxOutputLimit(String(entity.item.policy?.maxOutputLimit ?? ""));
			setDisabledCapabilities(
				entity.item.policy?.disabledCapabilities.join(", ") ?? "",
			);
			setPriceMode(entity.item.pricingMode ?? "source_cost");
			setMarkup(String(entity.item.markupBps ?? 2000));
			const storedPricePolicy = entity.item.pricePolicy;
			const storedFixedPrices =
				storedPricePolicy &&
				typeof storedPricePolicy === "object" &&
				"mode" in storedPricePolicy &&
				storedPricePolicy.mode === "fixed" &&
				"fixedPrices" in storedPricePolicy
					? storedPricePolicy.fixedPrices
					: { version: 1 };
			setFixedPricesJson(JSON.stringify(storedFixedPrices, null, 2));
		}
	}, [entity]);

	if (!entity) {
		return null;
	}
	const save = () => {
		let operations: Operation[];
		if (entity.kind === "provider") {
			operations = [
				{
					version: 1,
					type: "provider.set_policy",
					providerId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch: {
						visible,
						enabled,
						lifecycle,
						displayNameOverride: displayName || null,
						descriptionOverride: description || null,
						websiteOverride: website || null,
						sortOrder: Number(sortOrder),
						deprecatedAt: deprecatedAt
							? new Date(deprecatedAt).toISOString()
							: null,
						retireAt: retireAt ? new Date(retireAt).toISOString() : null,
						replacementProviderId: replacement || null,
					},
				},
			];
		} else if (entity.kind === "model") {
			operations = [
				{
					version: 1,
					type: "model.set_policy",
					modelId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch: {
						visible,
						enabled,
						allowDirect,
						lifecycle,
						replacementModelId: replacement || null,
						retireAt: retireAt ? new Date(retireAt).toISOString() : null,
						deprecatedAt: deprecatedAt
							? new Date(deprecatedAt).toISOString()
							: null,
						retirementMessage: retirementMessage || null,
						displayNameOverride: displayName || null,
						descriptionOverride: description || null,
						aliasesOverride: aliases.trim()
							? aliases
									.split(",")
									.map((value) => value.trim())
									.filter(Boolean)
							: null,
						sortOrder: Number(sortOrder),
					},
				},
			];
		} else {
			const requestedCapabilities = disabledCapabilities
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			const invalidCapabilities = requestedCapabilities.filter(
				(value) => !isDisabledCapability(value),
			);
			if (invalidCapabilities.length > 0) {
				toast.error(
					`Unsupported capability name${invalidCapabilities.length === 1 ? "" : "s"}: ${invalidCapabilities.join(", ")}`,
				);
				return;
			}
			operations = [
				{
					version: 1,
					type: "mapping.set_policy",
					mappingId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch: {
						enabled,
						externalIdOverride:
							externalId === entity.item.externalId ? null : externalId,
						priority: Number(priority),
						weight: Number(weight),
						breakerEnabled,
						contextSizeLimit: contextSizeLimit
							? Number(contextSizeLimit)
							: null,
						maxOutputLimit: maxOutputLimit ? Number(maxOutputLimit) : null,
						disabledCapabilities:
							requestedCapabilities.filter(isDisabledCapability),
					},
				},
			];
			if (priceMode === "source_cost") {
				operations.push({
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: entity.item.id,
					expectedUpdatedAt: entity.item.pricePolicyUpdatedAt,
					policy: { mode: "source_cost" },
				});
			} else if (priceMode === "markup") {
				operations.push({
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: entity.item.id,
					expectedUpdatedAt: entity.item.pricePolicyUpdatedAt,
					policy: { mode: "markup", markupBps: Number(markup) },
				});
			} else {
				let fixedPrices: Extract<
					Extract<Operation, { type: "mapping.set_price_policy" }>["policy"],
					{ mode: "fixed" }
				>["fixedPrices"];
				try {
					fixedPrices = JSON.parse(fixedPricesJson) as typeof fixedPrices;
				} catch {
					toast.error("Fixed prices must be valid JSON");
					return;
				}
				operations.push({
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: entity.item.id,
					expectedUpdatedAt: entity.item.pricePolicyUpdatedAt,
					policy: {
						mode: "fixed",
						fixedPrices,
					},
				});
			}
		}
		onOperations(operations);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Edit {entity.kind}</DialogTitle>
					<DialogDescription>
						{entity.item.id} · source metadata remains unchanged.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{entity.kind !== "mapping" && (
						<>
							<div className="flex items-center justify-between rounded-lg border p-3">
								<Label>Visible to customers</Label>
								<Switch checked={visible} onCheckedChange={setVisible} />
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Context limit</Label>
									<Input
										type="number"
										value={contextSizeLimit}
										onChange={(event) =>
											setContextSizeLimit(event.target.value)
										}
										placeholder="Source limit"
									/>
								</div>
								<div className="space-y-2">
									<Label>Max output limit</Label>
									<Input
										type="number"
										value={maxOutputLimit}
										onChange={(event) => setMaxOutputLimit(event.target.value)}
										placeholder="Source limit"
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Disabled capabilities (comma-separated)</Label>
								<Input
									value={disabledCapabilities}
									onChange={(event) =>
										setDisabledCapabilities(event.target.value)
									}
									placeholder="tools, vision, streaming"
								/>
							</div>
							<div className="flex items-center justify-between rounded-lg border p-3">
								<Label>API available</Label>
								<Switch checked={enabled} onCheckedChange={setEnabled} />
							</div>
							{entity.kind === "model" && (
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>Allow direct use while hidden</Label>
									<Switch
										checked={allowDirect}
										onCheckedChange={setAllowDirect}
									/>
								</div>
							)}
							<div className="space-y-2">
								<Label>Lifecycle</Label>
								<Select
									value={lifecycle}
									onValueChange={(value) =>
										setLifecycle(value as typeof lifecycle)
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{["draft", "active", "deprecated", "retired"].map(
											(value) => (
												<SelectItem key={value} value={value}>
													{value}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Display name override</Label>
								<Input
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
									placeholder="Use source name"
								/>
							</div>
							<div className="space-y-2">
								<Label>Description override</Label>
								<Textarea
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									placeholder="Use source description"
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Sort order</Label>
									<Input
										type="number"
										value={sortOrder}
										onChange={(event) => setSortOrder(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Deprecated at</Label>
									<Input
										type="datetime-local"
										value={deprecatedAt}
										onChange={(event) => setDeprecatedAt(event.target.value)}
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Retire at</Label>
								<Input
									type="datetime-local"
									value={retireAt}
									onChange={(event) => setRetireAt(event.target.value)}
								/>
							</div>
							{entity.kind === "provider" && (
								<>
									<div className="space-y-2">
										<Label>Website override</Label>
										<Input
											type="url"
											value={website}
											onChange={(event) => setWebsite(event.target.value)}
										/>
									</div>
									<div className="space-y-2">
										<Label>Replacement provider ID</Label>
										<Input
											value={replacement}
											onChange={(event) => setReplacement(event.target.value)}
										/>
									</div>
								</>
							)}
						</>
					)}
					{entity.kind === "model" && (
						<>
							<div className="space-y-2">
								<Label>Replacement model ID</Label>
								<Input
									value={replacement}
									onChange={(event) => setReplacement(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Aliases (comma-separated)</Label>
								<Input
									value={aliases}
									onChange={(event) => setAliases(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Retirement message</Label>
								<Textarea
									value={retirementMessage}
									onChange={(event) => setRetirementMessage(event.target.value)}
								/>
							</div>
						</>
					)}
					{entity.kind === "mapping" && (
						<>
							<div className="flex items-center justify-between rounded-lg border p-3">
								<Label>Routing enabled</Label>
								<Switch checked={enabled} onCheckedChange={setEnabled} />
							</div>
							<div className="space-y-2">
								<Label>External model ID</Label>
								<Input
									value={externalId}
									onChange={(event) => setExternalId(event.target.value)}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Priority</Label>
									<Input
										type="number"
										value={priority}
										onChange={(event) => setPriority(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Traffic weight</Label>
									<Input
										type="number"
										min="0"
										max="10000"
										value={weight}
										onChange={(event) => setWeight(event.target.value)}
									/>
								</div>
							</div>
							<div className="flex items-center justify-between rounded-lg border p-3">
								<Label>Circuit breaker</Label>
								<Switch
									checked={breakerEnabled}
									onCheckedChange={setBreakerEnabled}
								/>
							</div>
							<div className="space-y-2">
								<Label>Customer pricing</Label>
								<Select
									value={priceMode}
									onValueChange={(value) =>
										setPriceMode(value as typeof priceMode)
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="source_cost">Source cost</SelectItem>
										<SelectItem value="markup">Markup</SelectItem>
										<SelectItem value="fixed">Fixed</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{priceMode === "markup" && (
								<div className="space-y-2">
									<Label>Markup basis points (2000 = 20%)</Label>
									<Input
										type="number"
										value={markup}
										onChange={(event) => setMarkup(event.target.value)}
									/>
								</div>
							)}
							{priceMode === "fixed" && (
								<div className="space-y-2">
									<Label>Fixed prices JSON (all billable units)</Label>
									<Textarea
										className="min-h-48 font-mono text-xs"
										value={fixedPricesJson}
										onChange={(event) => setFixedPricesJson(event.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Supports token, image, audio, request, web-search, OCR,
										character, cache-write, and per-resolution video prices.
									</p>
								</div>
							)}
						</>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={save}>Preview change</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function CatalogClient({
	initialSummary,
	initialProviders,
	initialModels,
	initialMappings,
	initialChanges,
	credentials,
}: {
	initialSummary: Summary;
	initialProviders: ProviderPage;
	initialModels: ModelPage;
	initialMappings: MappingPage;
	initialChanges: Change[];
	credentials: Credential[];
}) {
	const api = useFetchClient();
	const [summary, setSummary] = useState(initialSummary);
	const [providers, setProviders] = useState(initialProviders);
	const [models, setModels] = useState(initialModels);
	const [mappings, setMappings] = useState(initialMappings);
	const [changes, setChanges] = useState(initialChanges);
	const [tab, setTab] = useState("overview");
	const [search, setSearch] = useState("");
	const [state, setState] = useState<ListState>("all");
	const [providerFilter, setProviderFilter] = useState("");
	const [modality, setModality] = useState("all");
	const [loading, setLoading] = useState(false);
	const [selected, setSelected] = useState<Map<string, Entity>>(new Map());
	const [operations, setOperations] = useState<Operation[]>([]);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [editing, setEditing] = useState<Entity | null>(null);
	const [editOpen, setEditOpen] = useState(false);
	const [health, setHealth] = useState<
		Awaited<ReturnType<typeof api.GET>>["data"] | null
	>(null);
	const [healthOpen, setHealthOpen] = useState(false);
	const [healthMapping, setHealthMapping] = useState<MappingItem | null>(null);
	const [confirmRollback, setConfirmRollback] = useState<Change | null>(null);
	const [rollbackPreview, setRollbackPreview] =
		useState<RollbackPreview | null>(null);
	const [rollbackConfirmText, setRollbackConfirmText] = useState("");
	const rollbackAffectedCount = rollbackPreview
		? rollbackPreview.affected.providers +
			rollbackPreview.affected.models +
			rollbackPreview.affected.mappings
		: 0;
	const rollbackConfirmPhrase = `ROLLBACK ${rollbackAffectedCount}`;

	const openRollbackPreview = async (change: Change) => {
		const result = await api.POST(
			"/admin/catalog/change-sets/{id}/rollback/preview",
			{ params: { path: { id: change.id } } },
		);
		if (result.error || !result.data) {
			toast.error(message(result.error));
			return;
		}
		setRollbackPreview(result.data);
		setConfirmRollback(change);
	};

	const listForTab =
		tab === "providers" ? providers : tab === "models" ? models : mappings;
	const fetchList = useCallback(
		async (target: "providers" | "models" | "mappings", page = 1) => {
			setLoading(true);
			try {
				const params = {
					query: {
						page,
						pageSize: 50,
						state,
						...(search.trim() ? { search: search.trim() } : {}),
						...(providerFilter.trim()
							? { providerId: providerFilter.trim() }
							: {}),
						...(modality !== "all" ? { modality } : {}),
					},
				};
				if (target === "providers") {
					const result = await api.GET("/admin/catalog/providers", { params });
					if (result.data) {
						setProviders(result.data);
					} else {
						throw new Error(message(result.error));
					}
				}
				if (target === "models") {
					const result = await api.GET("/admin/catalog/models", { params });
					if (result.data) {
						setModels(result.data);
					} else {
						throw new Error(message(result.error));
					}
				}
				if (target === "mappings") {
					const result = await api.GET("/admin/catalog/mappings", { params });
					if (result.data) {
						setMappings(result.data);
					} else {
						throw new Error(message(result.error));
					}
				}
			} catch (error) {
				toast.error(message(error));
			} finally {
				setLoading(false);
			}
		},
		[api, modality, providerFilter, search, state],
	);

	useEffect(() => {
		if (tab === "providers" || tab === "models" || tab === "mappings") {
			const timer = setTimeout(() => void fetchList(tab, 1), 250);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [fetchList, tab]);

	const refreshAll = async () => {
		const [summaryResult, changesResult] = await Promise.all([
			api.GET("/admin/catalog/summary"),
			api.GET("/admin/catalog/change-sets"),
		]);
		if (summaryResult.data) {
			setSummary(summaryResult.data);
		}
		if (changesResult.data) {
			setChanges(changesResult.data);
		}
		if (tab === "providers" || tab === "models" || tab === "mappings") {
			await fetchList(tab, 1);
		}
		setSelected(new Map());
	};

	const stage = (next: Operation[]) => {
		setOperations(next);
		setPreviewOpen(true);
	};
	const bulkPolicy = (action: "enable" | "disable" | "hide" | "retire") => {
		const next: Operation[] = [];
		for (const entity of Array.from(selected.values())) {
			if (entity.kind === "provider") {
				next.push({
					version: 1,
					type: "provider.set_policy",
					providerId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch:
						action === "enable"
							? { enabled: true, visible: true, lifecycle: "active" }
							: action === "hide"
								? { visible: false }
								: action === "retire"
									? { enabled: false, visible: false, lifecycle: "retired" }
									: { enabled: false },
				});
			}
			if (entity.kind === "model") {
				next.push({
					version: 1,
					type: "model.set_policy",
					modelId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch:
						action === "enable"
							? { enabled: true, visible: true, lifecycle: "active" }
							: action === "hide"
								? { visible: false }
								: action === "retire"
									? { enabled: false, visible: false, lifecycle: "retired" }
									: { enabled: false },
				});
			}
			if (entity.kind === "mapping") {
				next.push({
					version: 1,
					type: "mapping.set_policy",
					mappingId: entity.item.id,
					expectedUpdatedAt: entity.item.policy?.updatedAt ?? null,
					patch: { enabled: action === "enable" },
				});
			}
		}
		stage(next);
	};

	const togglePage = (checked: boolean) => {
		const next = new Map(selected);
		if (tab === "providers") {
			for (const item of providers.items) {
				if (checked) {
					next.set(`provider:${item.id}`, { kind: "provider", item });
				} else {
					next.delete(`provider:${item.id}`);
				}
			}
		}
		if (tab === "models") {
			for (const item of models.items) {
				if (checked) {
					next.set(`model:${item.id}`, { kind: "model", item });
				} else {
					next.delete(`model:${item.id}`);
				}
			}
		}
		if (tab === "mappings") {
			for (const item of mappings.items) {
				if (checked) {
					next.set(`mapping:${item.id}`, { kind: "mapping", item });
				} else {
					next.delete(`mapping:${item.id}`);
				}
			}
		}
		setSelected(next);
	};

	const toggleOne = (entity: Entity, checked: boolean) => {
		const key = `${entity.kind}:${entity.item.id}`;
		const next = new Map(selected);
		if (checked) {
			next.set(key, entity);
		} else {
			next.delete(key);
		}
		setSelected(next);
	};
	const openEdit = (entity: Entity) => {
		setEditing(entity);
		setEditOpen(true);
	};
	const showHealth = async (item: MappingItem) => {
		setHealthOpen(true);
		setHealthMapping(item);
		setHealth(null);
		const result = await api.GET("/admin/catalog/mappings/{id}/health", {
			params: { path: { id: item.id } },
		});
		setHealth(result.data ?? null);
		if (result.error) {
			toast.error(message(result.error));
		}
	};
	const resetBreaker = async () => {
		if (!healthMapping) {
			return;
		}
		const result = await api.POST(
			"/admin/catalog/mappings/{id}/breaker/reset",
			{ params: { path: { id: healthMapping.id } } },
		);
		if (result.error) {
			toast.error(message(result.error));
			return;
		}
		toast.success("Circuit breaker reset");
		await showHealth(healthMapping);
	};
	const runTest = async (item: MappingItem) => {
		const credential = credentials.find(
			(value) =>
				value.provider === item.providerId &&
				value.status === "active" &&
				value.validationStatus === "valid",
		);
		if (!credential) {
			toast.error(
				"Add and validate a matching Platform Provider credential first",
			);
			return;
		}
		const result = await api.POST("/admin/catalog/mappings/{id}/test", {
			params: { path: { id: item.id } },
			body: { credentialId: credential.id, testProfile: "minimal" },
		});
		if (result.error) {
			toast.error(message(result.error));
		} else {
			toast.success(result.data?.sanitizedMessage ?? "Mapping test completed");
			await showHealth(item);
		}
	};

	return (
		<div className="space-y-6 p-4 md:p-6 lg:p-8">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-sm font-medium text-primary">
						Platform operations
					</p>
					<h1 className="text-3xl font-semibold tracking-tight">
						Model Catalog
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Customer visibility, API availability, upstream routing, pricing,
						and lifecycle in one revisioned policy.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline">Revision {summary.revision}</Badge>
					<Button variant="outline" onClick={() => void refreshAll()}>
						<RefreshCw className="size-4" />
						Refresh
					</Button>
				</div>
			</div>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					setTab(value);
					setSelected(new Map());
				}}
			>
				<TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="providers">Providers</TabsTrigger>
					<TabsTrigger value="models">Models</TabsTrigger>
					<TabsTrigger value="mappings">Mappings</TabsTrigger>
					<TabsTrigger value="changes">Changes</TabsTrigger>
				</TabsList>
				<TabsContent value="overview" className="space-y-5">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{[
							{
								label: "Visible models",
								value: summary.models.visible,
								detail: `${summary.models.available} API available`,
							},
							{
								label: "Visible providers",
								value: summary.providers.visible,
								detail: `${summary.providers.available} credential-ready`,
							},
							{
								label: "Routable mappings",
								value: summary.mappings.routable,
								detail: `${summary.mappings.total} configured`,
							},
							{
								label: "Launch blockers",
								value: summary.mappings.blocked,
								detail: "Unavailable mappings",
							},
						].map((stat) => (
							<Card key={stat.label}>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm text-muted-foreground">
										{stat.label}
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="text-3xl font-semibold">{stat.value}</div>
									<p className="mt-1 text-xs text-muted-foreground">
										{stat.detail}
									</p>
								</CardContent>
							</Card>
						))}
					</div>
					<div className="grid gap-4 lg:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle>Launch posture</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="flex items-center justify-between">
									<span>Revision checksum</span>
									<code className="max-w-64 truncate text-xs">
										{summary.checksum}
									</code>
								</div>
								<div className="flex items-center justify-between">
									<span>Blocked mapping count</span>
									{healthBadge(
										summary.mappings.blocked === 0,
										"Ready",
										`${summary.mappings.blocked} blocked`,
									)}
								</div>
								<Alert>
									<ShieldCheck className="size-4" />
									<AlertTitle>Activation is guarded</AlertTitle>
									<AlertDescription>
										Catalog previews block missing credentials, prices, tests,
										replacements, and fallback coverage before publication.
									</AlertDescription>
								</Alert>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>Operator workflow</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3 text-sm">
								<p>1. Add and validate shared keys in Platform Providers.</p>
								<p>
									2. Configure and test mappings, prices, priority, and weight.
								</p>
								<p>
									3. Activate providers and models, preview impact, then
									publish.
								</p>
								<Button asChild variant="outline">
									<Link href="/platform-providers">
										Open Platform Providers <ExternalLink className="size-4" />
									</Link>
								</Button>
							</CardContent>
						</Card>
					</div>
				</TabsContent>
				{(["providers", "models", "mappings"] as const).map((kind) => (
					<TabsContent key={kind} value={kind} className="space-y-4">
						<div className="sticky top-3 z-20 flex flex-col gap-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:flex-wrap sm:items-center">
							<div className="relative flex-1">
								<Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
								<Input
									className="pl-9"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={`Search ${kind}…`}
								/>
							</div>
							<StateFilter value={state} onChange={setState} />
							{kind !== "providers" && (
								<Input
									className="w-48"
									value={providerFilter}
									onChange={(event) => setProviderFilter(event.target.value)}
									placeholder="Provider ID"
									aria-label="Filter by provider ID"
								/>
							)}
							{kind !== "providers" && (
								<Select value={modality} onValueChange={setModality}>
									<SelectTrigger
										className="w-44"
										aria-label="Filter by modality"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All modalities</SelectItem>
										<SelectItem value="text">Text</SelectItem>
										<SelectItem value="image">Image</SelectItem>
										<SelectItem value="audio">Audio</SelectItem>
										<SelectItem value="video">Video</SelectItem>
										<SelectItem value="embedding">Embedding</SelectItem>
										<SelectItem value="moderation">Moderation</SelectItem>
									</SelectContent>
								</Select>
							)}
							{selected.size > 0 && (
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">{selected.size} selected</Badge>
									<Button size="sm" onClick={() => bulkPolicy("enable")}>
										Activate
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => bulkPolicy("disable")}
									>
										Disable
									</Button>
									{kind !== "mappings" && (
										<>
											<Button
												size="sm"
												variant="outline"
												onClick={() => bulkPolicy("hide")}
											>
												Hide
											</Button>
											<Button
												size="sm"
												variant="destructive"
												onClick={() => bulkPolicy("retire")}
											>
												Retire
											</Button>
										</>
									)}
								</div>
							)}
						</div>
						<div className="overflow-hidden rounded-xl border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-10">
											<Checkbox
												aria-label="Select page"
												onCheckedChange={(checked) =>
													togglePage(checked === true)
												}
											/>
										</TableHead>
										{kind === "providers" && (
											<>
												<TableHead>Provider</TableHead>
												<TableHead>Customer state</TableHead>
												<TableHead>Credential</TableHead>
												<TableHead>Lifecycle</TableHead>
											</>
										)}
										{kind === "models" && (
											<>
												<TableHead>Model</TableHead>
												<TableHead>Family / output</TableHead>
												<TableHead>Customer state</TableHead>
												<TableHead>Lifecycle</TableHead>
											</>
										)}
										{kind === "mappings" && (
											<>
												<TableHead>Mapping</TableHead>
												<TableHead>Route</TableHead>
												<TableHead>Pricing</TableHead>
												<TableHead>Readiness</TableHead>
											</>
										)}
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{kind === "providers" &&
										providers.items.map((item) => {
											const entity: Entity = { kind: "provider", item };
											return (
												<TableRow key={item.id}>
													<TableCell>
														<Checkbox
															checked={selected.has(`provider:${item.id}`)}
															onCheckedChange={(checked) =>
																toggleOne(entity, checked === true)
															}
														/>
													</TableCell>
													<TableCell>
														<div className="font-medium">{item.name}</div>
														<div className="text-xs text-muted-foreground">
															{item.id}
														</div>
													</TableCell>
													<TableCell className="space-x-1">
														{healthBadge(item.visible, "Visible", "Hidden")}
														{healthBadge(
															item.available,
															"Available",
															"Unavailable",
														)}
													</TableCell>
													<TableCell>
														{healthBadge(
															item.credentialAvailable,
															"Ready",
															"Missing",
														)}
													</TableCell>
													<TableCell>
														<Badge variant="outline">{item.lifecycle}</Badge>
													</TableCell>
													<TableCell className="text-right">
														<Button
															variant="ghost"
															size="icon"
															onClick={() => openEdit(entity)}
															aria-label={`Edit ${item.id}`}
														>
															<Pencil className="size-4" />
														</Button>
													</TableCell>
												</TableRow>
											);
										})}
									{kind === "models" &&
										models.items.map((item) => {
											const entity: Entity = { kind: "model", item };
											return (
												<TableRow key={item.id}>
													<TableCell>
														<Checkbox
															checked={selected.has(`model:${item.id}`)}
															onCheckedChange={(checked) =>
																toggleOne(entity, checked === true)
															}
														/>
													</TableCell>
													<TableCell>
														<div className="font-medium">{item.name}</div>
														<div className="text-xs text-muted-foreground">
															{item.id}
														</div>
													</TableCell>
													<TableCell>
														<div>{item.family}</div>
														<div className="text-xs text-muted-foreground">
															{item.output.join(", ")}
														</div>
													</TableCell>
													<TableCell className="space-x-1">
														{healthBadge(item.visible, "Visible", "Hidden")}
														{healthBadge(
															item.available,
															"Available",
															"Unavailable",
														)}
														{item.allowDirect && (
															<Badge variant="outline">Direct</Badge>
														)}
													</TableCell>
													<TableCell>
														<Badge variant="outline">{item.lifecycle}</Badge>
														{item.replacementModelId && (
															<div className="mt-1 text-xs">
																→ {item.replacementModelId}
															</div>
														)}
													</TableCell>
													<TableCell className="text-right">
														<Button
															variant="ghost"
															size="icon"
															onClick={() => openEdit(entity)}
															aria-label={`Edit ${item.id}`}
														>
															<Pencil className="size-4" />
														</Button>
													</TableCell>
												</TableRow>
											);
										})}
									{kind === "mappings" &&
										mappings.items.map((item) => {
											const entity: Entity = { kind: "mapping", item };
											return (
												<TableRow key={item.id}>
													<TableCell>
														<Checkbox
															checked={selected.has(`mapping:${item.id}`)}
															onCheckedChange={(checked) =>
																toggleOne(entity, checked === true)
															}
														/>
													</TableCell>
													<TableCell>
														<div className="font-medium">{item.modelId}</div>
														<div className="text-xs text-muted-foreground">
															{item.providerId} · {item.externalId}
															{item.region ? ` · ${item.region}` : ""}
														</div>
													</TableCell>
													<TableCell>
														<div className="font-mono text-xs">
															P{item.priority} · W{item.weight}
														</div>
														<div className="mt-1">
															{healthBadge(
																item.routable,
																"Routable",
																item.probeOnly ? "Probe only" : "Blocked",
															)}
														</div>
													</TableCell>
													<TableCell>
														<PriceSummary item={item} />
													</TableCell>
													<TableCell>
														{healthBadge(
															item.credentialAvailable,
															"Credential",
															"No key",
														)}
														{item.reasons.length > 0 && (
															<div
																className="mt-1 max-w-52 truncate text-xs text-muted-foreground"
																title={item.reasons.join(", ")}
															>
																{item.reasons.join(", ")}
															</div>
														)}
													</TableCell>
													<TableCell className="text-right">
														<div className="flex justify-end">
															<Button
																variant="ghost"
																size="icon"
																onClick={() => void runTest(item)}
																aria-label={`Test ${item.id}`}
															>
																<TestTube2 className="size-4" />
															</Button>
															<Button
																variant="ghost"
																size="icon"
																onClick={() => void showHealth(item)}
																aria-label={`Health ${item.id}`}
															>
																<Activity className="size-4" />
															</Button>
															<Button
																variant="ghost"
																size="icon"
																onClick={() => openEdit(entity)}
																aria-label={`Edit ${item.id}`}
															>
																<Pencil className="size-4" />
															</Button>
														</div>
													</TableCell>
												</TableRow>
											);
										})}
									{listForTab.items.length === 0 && (
										<TableRow>
											<TableCell
												colSpan={6}
												className="h-32 text-center text-muted-foreground"
											>
												{loading ? (
													<Loader2 className="mx-auto size-5 animate-spin" />
												) : (
													"No catalog entries match this filter."
												)}
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
							<Pager
								page={listForTab.page}
								pageSize={listForTab.pageSize}
								total={listForTab.total}
								onPage={(page) => void fetchList(kind, page)}
							/>
						</div>
					</TabsContent>
				))}
				<TabsContent value="changes">
					<div className="overflow-hidden rounded-xl border bg-card">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Change</TableHead>
									<TableHead>State</TableHead>
									<TableHead>Schedule / applied</TableHead>
									<TableHead>Revision</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{changes.map((change) => (
									<TableRow key={change.id}>
										<TableCell>
											<div className="font-medium">{change.title}</div>
											<div className="max-w-lg truncate text-xs text-muted-foreground">
												{change.reason}
											</div>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													change.state === "failed" ? "destructive" : "outline"
												}
											>
												{change.state}
											</Badge>
										</TableCell>
										<TableCell className="text-xs">
											{change.effectiveAt
												? new Date(change.effectiveAt).toLocaleString()
												: change.appliedAt
													? new Date(change.appliedAt).toLocaleString()
													: "Draft"}
										</TableCell>
										<TableCell>
											{change.appliedRevision ?? change.baseRevision ?? "—"}
										</TableCell>
										<TableCell className="text-right">
											{change.state === "scheduled" && (
												<Button
													variant="ghost"
													size="sm"
													onClick={async () => {
														const result = await api.POST(
															"/admin/catalog/change-sets/{id}/cancel",
															{ params: { path: { id: change.id } } },
														);
														if (result.error) {
															toast.error(message(result.error));
														} else {
															toast.success("Schedule cancelled");
															await refreshAll();
														}
													}}
												>
													Cancel
												</Button>
											)}
											{(change.state === "applied" ||
												change.state === "rolled_back") && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => void openRollbackPreview(change)}
												>
													<RotateCcw className="size-4" />
													Rollback
												</Button>
											)}
										</TableCell>
									</TableRow>
								))}
								{changes.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={5}
											className="h-32 text-center text-muted-foreground"
										>
											No catalog changes yet.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</TabsContent>
			</Tabs>
			<PreviewSheet
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				operations={operations}
				revision={summary.revision}
				onPublished={refreshAll}
			/>
			<EditEntityDialog
				entity={editing}
				open={editOpen}
				onOpenChange={setEditOpen}
				onOperations={stage}
			/>
			<Dialog open={healthOpen} onOpenChange={setHealthOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Mapping health</DialogTitle>
						<DialogDescription>
							Live breaker, credentials, test, and five-minute traffic summary.
						</DialogDescription>
					</DialogHeader>
					{health ? (
						<>
							<pre className="max-h-[55vh] overflow-auto rounded-lg bg-muted p-4 text-xs">
								{JSON.stringify(health, null, 2)}
							</pre>
							<DialogFooter>
								<Button
									variant="outline"
									disabled={health.latestTest?.status !== "passed"}
									onClick={() => void resetBreaker()}
								>
									Reset breaker
								</Button>
							</DialogFooter>
						</>
					) : (
						<Loader2 className="mx-auto size-6 animate-spin" />
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!confirmRollback}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmRollback(null);
						setRollbackPreview(null);
						setRollbackConfirmText("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rollback catalog revision</DialogTitle>
						<DialogDescription>
							This creates and applies a new inverse revision; history is
							retained.
						</DialogDescription>
					</DialogHeader>
					<Alert variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>High-impact operation</AlertTitle>
						<AlertDescription>
							Rollback {confirmRollback?.title}?
						</AlertDescription>
					</Alert>
					{rollbackPreview && (
						<div className="space-y-3">
							<div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
								{Object.entries(rollbackPreview.affected).map(
									([key, value]) => (
										<div key={key} className="rounded-lg border p-3">
											<div className="text-muted-foreground capitalize">
												{key}
											</div>
											<div className="text-lg font-semibold">
												{value ?? "Unknown"}
											</div>
										</div>
									),
								)}
							</div>
							{!rollbackPreview.valid && (
								<Alert variant="destructive">
									<AlertTitle>Rollback blocked</AlertTitle>
									<AlertDescription>
										{rollbackPreview.blockers
											.map(
												(item) =>
													`${item.entityId}: ${item.reasons.join(", ")}`,
											)
											.join(" · ")}
									</AlertDescription>
								</Alert>
							)}
							{rollbackPreview.warnings.length > 0 && (
								<p className="text-sm text-muted-foreground">
									{rollbackPreview.warnings.join(" · ")}
								</p>
							)}
						</div>
					)}
					<div className="space-y-2">
						<Label htmlFor="rollback-confirm">
							Type {rollbackConfirmPhrase} to continue
						</Label>
						<Input
							id="rollback-confirm"
							value={rollbackConfirmText}
							onChange={(event) => setRollbackConfirmText(event.target.value)}
							autoComplete="off"
						/>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setConfirmRollback(null);
								setRollbackPreview(null);
								setRollbackConfirmText("");
							}}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={
								!rollbackPreview?.valid ||
								rollbackConfirmText !== rollbackConfirmPhrase
							}
							onClick={async () => {
								if (!confirmRollback) {
									return;
								}
								const result = await api.POST(
									"/admin/catalog/change-sets/{id}/rollback",
									{ params: { path: { id: confirmRollback.id } } },
								);
								if (result.error) {
									toast.error(message(result.error));
								} else {
									toast.success(
										`Rollback revision ${result.data?.catalogRevision} applied`,
									);
									setConfirmRollback(null);
									setRollbackPreview(null);
									setRollbackConfirmText("");
									await refreshAll();
								}
							}}
						>
							<RotateCcw className="size-4" />
							Confirm rollback
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
