"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
	formatSourceFieldValue,
	parseSourceFieldDraft,
	sourceFieldDraft,
	sourceFieldsFor,
} from "./source-fields";

import type { SourceFieldDescriptor } from "./source-fields";
import type { paths } from "@/lib/api/v1";

type ProviderItem =
	paths["/admin/catalog/providers"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
type ModelItem =
	paths["/admin/catalog/models"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
type MappingItem =
	paths["/admin/catalog/mappings"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
type Entity =
	| { kind: "provider"; item: ProviderItem }
	| { kind: "model"; item: ModelItem }
	| { kind: "mapping"; item: MappingItem };
type ChangeBody =
	paths["/admin/catalog/change-sets"]["post"]["requestBody"]["content"]["application/json"];
type Operation = ChangeBody["operations"][number];
type PatchOf<T extends Operation["type"]> =
	Extract<Operation, { type: T }> extends { patch: infer P } ? P : never;

interface OverrideFieldView {
	value?: unknown;
	baseValue?: unknown;
	setAt?: string;
	setBy?: string;
}

interface FieldEdit {
	action: "keep" | "set" | "clear";
	draft: string;
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function FieldValueInput({
	field,
	draft,
	onChange,
}: {
	field: SourceFieldDescriptor;
	draft: string;
	onChange: (draft: string) => void;
}) {
	if (field.input === "boolean") {
		return (
			<Select value={draft || undefined} onValueChange={onChange}>
				<SelectTrigger aria-label={`New value for ${field.label}`}>
					<SelectValue placeholder="Choose…" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="true">true</SelectItem>
					<SelectItem value="false">false</SelectItem>
				</SelectContent>
			</Select>
		);
	}
	if (field.input === "select") {
		return (
			<Select value={draft || undefined} onValueChange={onChange}>
				<SelectTrigger aria-label={`New value for ${field.label}`}>
					<SelectValue placeholder="Choose…" />
				</SelectTrigger>
				<SelectContent>
					{(field.options ?? []).map((option) => (
						<SelectItem key={option} value={option}>
							{option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}
	if (field.input === "textarea" || field.input === "json") {
		return (
			<Textarea
				className={field.input === "json" ? "font-mono text-xs" : undefined}
				value={draft}
				onChange={(event) => onChange(event.target.value)}
				aria-label={`New value for ${field.label}`}
			/>
		);
	}
	return (
		<Input
			value={draft}
			onChange={(event) => onChange(event.target.value)}
			placeholder={
				field.input === "decimal"
					? "1.4e-6"
					: field.input === "csv"
						? "value-1, value-2"
						: undefined
			}
			aria-label={`New value for ${field.label}`}
		/>
	);
}

/**
 * Source-field editor. For static (code-mirrored) entries this is the
 * three-value editor — source / override / effective per field — staging
 * `*.set_source_override` patches (`null` clears one field's override). For
 * admin-created entries it edits the source row directly through `*.update`.
 */
export function SourceEditDialog({
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
	const [edits, setEdits] = useState<Record<string, FieldEdit>>({});

	useEffect(() => {
		setEdits({});
	}, [entity]);

	if (!entity) {
		return null;
	}
	const isAdmin = entity.item.source === "admin";
	const fields = sourceFieldsFor(entity.kind).filter((field) =>
		isAdmin ? field.updatable : field.overridable,
	);
	const sourceValues = entity.item.sourceValues as Record<string, unknown>;
	const overrides = (entity.item.sourceOverrides ?? null) as Record<
		string,
		OverrideFieldView
	> | null;
	const policyUpdatedAt = entity.item.policy?.updatedAt ?? null;
	const overrideCount = overrides ? Object.keys(overrides).length : 0;

	const editFor = (key: string): FieldEdit =>
		edits[key] ?? { action: "keep", draft: "" };

	const setAction = (
		field: SourceFieldDescriptor,
		action: FieldEdit["action"],
	) => {
		setEdits((previous) => ({
			...previous,
			[field.key]: {
				action,
				draft:
					action === "set"
						? sourceFieldDraft(
								field,
								overrides?.[field.key]?.value ?? sourceValues[field.key],
							)
						: "",
			},
		}));
	};

	const buildPatch = (): Record<string, unknown> | null => {
		const patch: Record<string, unknown> = {};
		for (const field of fields) {
			const edit = edits[field.key];
			if (!edit || edit.action === "keep") {
				continue;
			}
			if (edit.action === "clear") {
				patch[field.key] = null;
				continue;
			}
			const parsed = parseSourceFieldDraft(field, edit.draft);
			if (!parsed.ok) {
				toast.error(parsed.error);
				return null;
			}
			patch[field.key] = parsed.value;
		}
		if (Object.keys(patch).length === 0) {
			toast.error("No field changes to save");
			return null;
		}
		return patch;
	};

	const save = () => {
		const patch = buildPatch();
		if (!patch) {
			return;
		}
		let operation: Operation;
		if (entity.kind === "provider") {
			operation = isAdmin
				? {
						version: 1,
						type: "provider.update",
						providerId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"provider.update">,
					}
				: {
						version: 1,
						type: "provider.set_source_override",
						providerId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"provider.set_source_override">,
					};
		} else if (entity.kind === "model") {
			operation = isAdmin
				? {
						version: 1,
						type: "model.update",
						modelId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"model.update">,
					}
				: {
						version: 1,
						type: "model.set_source_override",
						modelId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"model.set_source_override">,
					};
		} else {
			operation = isAdmin
				? {
						version: 1,
						type: "mapping.update",
						mappingId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"mapping.update">,
					}
				: {
						version: 1,
						type: "mapping.set_source_override",
						mappingId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
						patch: patch as PatchOf<"mapping.set_source_override">,
					};
		}
		onOperations([operation]);
		onOpenChange(false);
	};

	const clearAllOverrides = () => {
		if (!policyUpdatedAt) {
			toast.error("No policy row anchors these overrides");
			return;
		}
		const operation: Operation =
			entity.kind === "provider"
				? {
						version: 1,
						type: "provider.clear_source_override",
						providerId: entity.item.id,
						expectedUpdatedAt: policyUpdatedAt,
					}
				: entity.kind === "model"
					? {
							version: 1,
							type: "model.clear_source_override",
							modelId: entity.item.id,
							expectedUpdatedAt: policyUpdatedAt,
						}
					: {
							version: 1,
							type: "mapping.clear_source_override",
							mappingId: entity.item.id,
							expectedUpdatedAt: policyUpdatedAt,
						};
		onOperations([operation]);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{isAdmin ? "Edit source fields" : "Source overrides"} ·{" "}
						{entity.kind}
					</DialogTitle>
					<DialogDescription>
						{entity.item.id} ·{" "}
						{isAdmin
							? "Admin-created entry: values are edited directly on the source row."
							: "Code-defined entry: the mirror stays untouched; overrides compose on top and clearing one reverts to upstream."}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					{fields.map((field) => {
						const edit = editFor(field.key);
						const override = overrides?.[field.key];
						const hasOverride = override !== undefined;
						const mirror = sourceValues[field.key];
						const effective = hasOverride ? override.value : mirror;
						const drifted =
							!isAdmin && hasOverride && !jsonEqual(override.baseValue, mirror);
						return (
							<div key={field.key} className="space-y-2 rounded-lg border p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<span className="text-sm font-medium">{field.label}</span>
										<span className="ml-2 font-mono text-xs text-muted-foreground">
											{field.key}
										</span>
										{drifted && (
											<Badge variant="destructive" className="ml-2">
												<AlertTriangle className="size-3" />
												Upstream moved
											</Badge>
										)}
									</div>
									<Select
										value={edit.action}
										onValueChange={(value) =>
											setAction(field, value as FieldEdit["action"])
										}
									>
										<SelectTrigger
											className="w-40"
											aria-label={`Action for ${field.label}`}
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="keep">Keep</SelectItem>
											<SelectItem value="set">
												{isAdmin ? "Set value" : "Set override"}
											</SelectItem>
											{!isAdmin && hasOverride && (
												<SelectItem value="clear">Clear override</SelectItem>
											)}
											{isAdmin && field.nullable && (
												<SelectItem value="clear">Set NULL</SelectItem>
											)}
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
									<div
										className="truncate"
										title={formatSourceFieldValue(mirror)}
									>
										{isAdmin ? "Current" : "Source"}:{" "}
										<code>{formatSourceFieldValue(mirror)}</code>
									</div>
									{!isAdmin && (
										<>
											<div
												className="truncate"
												title={
													hasOverride
														? formatSourceFieldValue(override.value)
														: undefined
												}
											>
												Override:{" "}
												<code>
													{hasOverride
														? formatSourceFieldValue(override.value)
														: "—"}
												</code>
											</div>
											<div
												className="truncate"
												title={formatSourceFieldValue(effective)}
											>
												Effective:{" "}
												<code>{formatSourceFieldValue(effective)}</code>
											</div>
										</>
									)}
								</div>
								{edit.action === "set" && (
									<FieldValueInput
										field={field}
										draft={edit.draft}
										onChange={(draft) =>
											setEdits((previous) => ({
												...previous,
												[field.key]: { action: "set", draft },
											}))
										}
									/>
								)}
							</div>
						);
					})}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{!isAdmin && overrideCount > 0 && (
						<Button variant="destructive" onClick={clearAllOverrides}>
							Clear all overrides ({overrideCount})
						</Button>
					)}
					<Button onClick={save}>Preview change</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
