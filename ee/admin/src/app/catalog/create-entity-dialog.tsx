"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { CATALOG_DATA_PROTOCOLS } from "./source-fields";

import type { paths } from "@/lib/api/v1";

type ChangeBody =
	paths["/admin/catalog/change-sets"]["post"]["requestBody"]["content"]["application/json"];
type Operation = ChangeBody["operations"][number];
type CreateOf<T extends Operation["type"]> =
	Extract<Operation, { type: T }> extends { create: infer C } ? C : never;

type TriState = "unset" | "true" | "false";

function TriStateSelect({
	label,
	value,
	onChange,
}: {
	label: string;
	value: TriState;
	onChange: (value: TriState) => void;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<Select
				value={value}
				onValueChange={(next) => onChange(next as TriState)}
			>
				<SelectTrigger aria-label={label}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="unset">Source default</SelectItem>
					<SelectItem value="true">true</SelectItem>
					<SelectItem value="false">false</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function triStateValue(value: TriState): boolean | undefined {
	return value === "unset" ? undefined : value === "true";
}

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Create forms for admin-owned catalog entities. Each form stages a single
 * `provider.create` / `model.create` / `mapping.create` operation; the
 * change-set preview enforces the contract invariants (reserved namespaces,
 * duplicate slots, missing parents) before anything is applied. Created
 * entries start as hidden drafts — activation stays behind the admission
 * gates (policy, price, credential, passed mapping test).
 */
export function CreateEntityDialog({
	kind,
	open,
	onOpenChange,
	onOperations,
}: {
	kind: "provider" | "model" | "mapping";
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOperations: (operations: Operation[]) => void;
}) {
	const [entityId, setEntityId] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [protocol, setProtocol] = useState<string>("openai-chat");
	const [website, setWebsite] = useState("");
	const [color, setColor] = useState("");
	const [announcement, setAnnouncement] = useState("");
	const [priority, setPriority] = useState("");
	const [maxTemperature, setMaxTemperature] = useState("");
	const [termsUrl, setTermsUrl] = useState("");
	const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState("");
	const [statusPageUrl, setStatusPageUrl] = useState("");
	const [apiKeyInstructions, setApiKeyInstructions] = useState("");
	const [streaming, setStreaming] = useState<TriState>("unset");
	const [cancellation, setCancellation] = useState<TriState>("unset");
	const [contentFilter, setContentFilter] = useState<TriState>("unset");
	const [family, setFamily] = useState("");
	const [aliases, setAliases] = useState("");
	const [output, setOutput] = useState("");
	const [free, setFree] = useState(false);
	const [modelId, setModelId] = useState("");
	const [providerId, setProviderId] = useState("");
	const [externalId, setExternalId] = useState("");
	const [region, setRegion] = useState("");
	const [contextSize, setContextSize] = useState("");
	const [maxOutput, setMaxOutput] = useState("");
	const [inputPrice, setInputPrice] = useState("");
	const [outputPrice, setOutputPrice] = useState("");
	const [cachedInputPrice, setCachedInputPrice] = useState("");
	const [requestPrice, setRequestPrice] = useState("");
	const [mappingStreaming, setMappingStreaming] = useState(true);
	const [vision, setVision] = useState<TriState>("unset");
	const [reasoning, setReasoning] = useState<TriState>("unset");
	const [tools, setTools] = useState<TriState>("unset");
	const [jsonOutput, setJsonOutput] = useState(false);
	const [jsonOutputSchema, setJsonOutputSchema] = useState(false);
	const [webSearch, setWebSearch] = useState(false);
	const [reasoningMaxTokens, setReasoningMaxTokens] = useState(false);
	const [advancedJson, setAdvancedJson] = useState("");

	useEffect(() => {
		if (!open) {
			return;
		}
		setEntityId("");
		setName("");
		setDescription("");
		setProtocol("openai-chat");
		setWebsite("");
		setColor("");
		setAnnouncement("");
		setPriority("");
		setMaxTemperature("");
		setTermsUrl("");
		setPrivacyPolicyUrl("");
		setStatusPageUrl("");
		setApiKeyInstructions("");
		setStreaming("unset");
		setCancellation("unset");
		setContentFilter("unset");
		setFamily("");
		setAliases("");
		setOutput("");
		setFree(false);
		setModelId("");
		setProviderId("");
		setExternalId("");
		setRegion("");
		setContextSize("");
		setMaxOutput("");
		setInputPrice("");
		setOutputPrice("");
		setCachedInputPrice("");
		setRequestPrice("");
		setMappingStreaming(true);
		setVision("unset");
		setReasoning("unset");
		setTools("unset");
		setJsonOutput(false);
		setJsonOutputSchema(false);
		setWebSearch(false);
		setReasoningMaxTokens(false);
		setAdvancedJson("");
	}, [open, kind]);

	const csv = (value: string): string[] =>
		value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);

	const optionalNumber = (value: string, label: string): number | undefined => {
		if (!value.trim()) {
			return undefined;
		}
		const parsed = Number(value);
		if (Number.isNaN(parsed)) {
			toast.error(`${label} must be a number`);
			throw new Error("invalid form value");
		}
		return parsed;
	};

	const optionalDecimal = (
		value: string,
		label: string,
	): string | undefined => {
		if (!value.trim()) {
			return undefined;
		}
		if (!DECIMAL_PATTERN.test(value.trim())) {
			toast.error(`${label} must be a decimal string like 1.4e-6`);
			throw new Error("invalid form value");
		}
		return value.trim();
	};

	const advancedFields = (): Record<string, unknown> => {
		if (!advancedJson.trim()) {
			return {};
		}
		try {
			const parsed = JSON.parse(advancedJson) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				toast.error("Additional fields must be a JSON object");
				throw new Error("invalid form value");
			}
			return parsed as Record<string, unknown>;
		} catch (error) {
			if (error instanceof Error && error.message === "invalid form value") {
				throw error;
			}
			toast.error("Additional fields must be valid JSON");
			throw new Error("invalid form value");
		}
	};

	const save = () => {
		try {
			let operation: Operation;
			if (kind === "provider") {
				if (!entityId.trim() || !name.trim()) {
					toast.error("Provider ID and name are required");
					return;
				}
				const create = {
					providerId: entityId.trim(),
					name: name.trim(),
					description,
					protocol: protocol as CreateOf<"provider.create">["protocol"],
					...(website.trim() ? { website: website.trim() } : {}),
					...(color.trim() ? { color: color.trim() } : {}),
					...(announcement.trim() ? { announcement: announcement.trim() } : {}),
					...(priority.trim()
						? { priority: optionalNumber(priority, "Priority") }
						: {}),
					...(maxTemperature.trim()
						? {
								maxTemperature: optionalNumber(
									maxTemperature,
									"Max temperature",
								),
							}
						: {}),
					...(termsUrl.trim() ? { termsUrl: termsUrl.trim() } : {}),
					...(privacyPolicyUrl.trim()
						? { privacyPolicyUrl: privacyPolicyUrl.trim() }
						: {}),
					...(statusPageUrl.trim()
						? { statusPageUrl: statusPageUrl.trim() }
						: {}),
					...(apiKeyInstructions.trim()
						? { apiKeyInstructions: apiKeyInstructions.trim() }
						: {}),
					...(triStateValue(streaming) === undefined
						? {}
						: { streaming: triStateValue(streaming) }),
					...(triStateValue(cancellation) === undefined
						? {}
						: { cancellation: triStateValue(cancellation) }),
					...(triStateValue(contentFilter) === undefined
						? {}
						: { contentFilter: triStateValue(contentFilter) }),
				};
				operation = {
					version: 1,
					type: "provider.create",
					expectedUpdatedAt: null,
					create: create as CreateOf<"provider.create">,
				};
			} else if (kind === "model") {
				if (!entityId.trim() || !family.trim()) {
					toast.error("Model ID and family are required");
					return;
				}
				const create = {
					modelId: entityId.trim(),
					family: family.trim(),
					...(name.trim() ? { name: name.trim() } : {}),
					...(description.trim() ? { description } : {}),
					...(aliases.trim() ? { aliases: csv(aliases) } : {}),
					...(output.trim() ? { output: csv(output) } : {}),
					...(free ? { free } : {}),
				};
				operation = {
					version: 1,
					type: "model.create",
					expectedUpdatedAt: null,
					create: create as CreateOf<"model.create">,
				};
			} else {
				if (!modelId.trim() || !providerId.trim() || !externalId.trim()) {
					toast.error("Model ID, provider ID, and external ID are required");
					return;
				}
				const create = {
					modelId: modelId.trim(),
					providerId: providerId.trim(),
					externalId: externalId.trim(),
					...(region.trim() ? { region: region.trim() } : {}),
					...(contextSize.trim()
						? { contextSize: optionalNumber(contextSize, "Context size") }
						: {}),
					...(maxOutput.trim()
						? { maxOutput: optionalNumber(maxOutput, "Max output") }
						: {}),
					...(inputPrice.trim()
						? { inputPrice: optionalDecimal(inputPrice, "Input price") }
						: {}),
					...(outputPrice.trim()
						? { outputPrice: optionalDecimal(outputPrice, "Output price") }
						: {}),
					...(cachedInputPrice.trim()
						? {
								cachedInputPrice: optionalDecimal(
									cachedInputPrice,
									"Cached input price",
								),
							}
						: {}),
					...(requestPrice.trim()
						? { requestPrice: optionalDecimal(requestPrice, "Request price") }
						: {}),
					...(mappingStreaming ? {} : { streaming: false }),
					...(triStateValue(vision) === undefined
						? {}
						: { vision: triStateValue(vision) }),
					...(triStateValue(reasoning) === undefined
						? {}
						: { reasoning: triStateValue(reasoning) }),
					...(triStateValue(tools) === undefined
						? {}
						: { tools: triStateValue(tools) }),
					...(jsonOutput ? { jsonOutput } : {}),
					...(jsonOutputSchema ? { jsonOutputSchema } : {}),
					...(webSearch ? { webSearch } : {}),
					...(reasoningMaxTokens ? { reasoningMaxTokens } : {}),
					...advancedFields(),
				};
				operation = {
					version: 1,
					type: "mapping.create",
					expectedUpdatedAt: null,
					create: create as CreateOf<"mapping.create">,
				};
			}
			onOperations([operation]);
			onOpenChange(false);
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "invalid form value") {
				throw error;
			}
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Create {kind}</DialogTitle>
					<DialogDescription>
						Created entries are admin-owned drafts: hidden, disabled, and
						unroutable until policy, pricing, credentials, and a passed mapping
						test admit them.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{kind === "provider" && (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label htmlFor="create-provider-id">Provider ID</Label>
									<Input
										id="create-provider-id"
										value={entityId}
										onChange={(event) => setEntityId(event.target.value)}
										placeholder="acme-relay"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="create-provider-name">Name</Label>
									<Input
										id="create-provider-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder="Acme Relay"
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Protocol</Label>
								<Select value={protocol} onValueChange={setProtocol}>
									<SelectTrigger aria-label="Protocol">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CATALOG_DATA_PROTOCOLS.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Description</Label>
								<Textarea
									value={description}
									onChange={(event) => setDescription(event.target.value)}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Website</Label>
									<Input
										type="url"
										value={website}
										onChange={(event) => setWebsite(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Color</Label>
									<Input
										value={color}
										onChange={(event) => setColor(event.target.value)}
										placeholder="#0ea5e9"
									/>
								</div>
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
									<Label>Max temperature</Label>
									<Input
										type="number"
										value={maxTemperature}
										onChange={(event) => setMaxTemperature(event.target.value)}
									/>
								</div>
							</div>
							<div className="grid grid-cols-3 gap-3">
								<TriStateSelect
									label="Streaming"
									value={streaming}
									onChange={setStreaming}
								/>
								<TriStateSelect
									label="Cancellation"
									value={cancellation}
									onChange={setCancellation}
								/>
								<TriStateSelect
									label="Content filter"
									value={contentFilter}
									onChange={setContentFilter}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Terms URL</Label>
									<Input
										type="url"
										value={termsUrl}
										onChange={(event) => setTermsUrl(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Privacy policy URL</Label>
									<Input
										type="url"
										value={privacyPolicyUrl}
										onChange={(event) =>
											setPrivacyPolicyUrl(event.target.value)
										}
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Status page URL</Label>
								<Input
									type="url"
									value={statusPageUrl}
									onChange={(event) => setStatusPageUrl(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Announcement</Label>
								<Textarea
									value={announcement}
									onChange={(event) => setAnnouncement(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>API key instructions</Label>
								<Textarea
									value={apiKeyInstructions}
									onChange={(event) =>
										setApiKeyInstructions(event.target.value)
									}
								/>
							</div>
						</>
					)}
					{kind === "model" && (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label htmlFor="create-model-id">Model ID</Label>
									<Input
										id="create-model-id"
										value={entityId}
										onChange={(event) => setEntityId(event.target.value)}
										placeholder="acme-chat-1"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="create-model-family">Family</Label>
									<Input
										id="create-model-family"
										value={family}
										onChange={(event) => setFamily(event.target.value)}
										placeholder="acme"
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Display name</Label>
								<Input
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Description</Label>
								<Textarea
									value={description}
									onChange={(event) => setDescription(event.target.value)}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Aliases (comma-separated)</Label>
									<Input
										value={aliases}
										onChange={(event) => setAliases(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Output modalities (comma-separated)</Label>
									<Input
										value={output}
										onChange={(event) => setOutput(event.target.value)}
										placeholder="text"
									/>
								</div>
							</div>
							<div className="flex items-center justify-between rounded-lg border p-3">
								<Label>Free model</Label>
								<Switch checked={free} onCheckedChange={setFree} />
							</div>
						</>
					)}
					{kind === "mapping" && (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label htmlFor="create-mapping-model">Model ID</Label>
									<Input
										id="create-mapping-model"
										value={modelId}
										onChange={(event) => setModelId(event.target.value)}
										placeholder="gpt-5.5"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="create-mapping-provider">Provider ID</Label>
									<Input
										id="create-mapping-provider"
										value={providerId}
										onChange={(event) => setProviderId(event.target.value)}
										placeholder="acme-relay"
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label htmlFor="create-mapping-external">External ID</Label>
									<Input
										id="create-mapping-external"
										value={externalId}
										onChange={(event) => setExternalId(event.target.value)}
										placeholder="gpt-5.5"
									/>
								</div>
								<div className="space-y-2">
									<Label>Region (optional)</Label>
									<Input
										value={region}
										onChange={(event) => setRegion(event.target.value)}
										placeholder="eu"
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Context size</Label>
									<Input
										type="number"
										value={contextSize}
										onChange={(event) => setContextSize(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>Max output</Label>
									<Input
										type="number"
										value={maxOutput}
										onChange={(event) => setMaxOutput(event.target.value)}
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Input price ($/token, e-6)</Label>
									<Input
										value={inputPrice}
										onChange={(event) => setInputPrice(event.target.value)}
										placeholder="1.4e-6"
									/>
								</div>
								<div className="space-y-2">
									<Label>Output price ($/token, e-6)</Label>
									<Input
										value={outputPrice}
										onChange={(event) => setOutputPrice(event.target.value)}
										placeholder="5.6e-6"
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label>Cached input price</Label>
									<Input
										value={cachedInputPrice}
										onChange={(event) =>
											setCachedInputPrice(event.target.value)
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Request price (flat USD)</Label>
									<Input
										value={requestPrice}
										onChange={(event) => setRequestPrice(event.target.value)}
									/>
								</div>
							</div>
							<div className="grid grid-cols-3 gap-3">
								<TriStateSelect
									label="Vision"
									value={vision}
									onChange={setVision}
								/>
								<TriStateSelect
									label="Reasoning"
									value={reasoning}
									onChange={setReasoning}
								/>
								<TriStateSelect
									label="Tools"
									value={tools}
									onChange={setTools}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>Streaming</Label>
									<Switch
										checked={mappingStreaming}
										onCheckedChange={setMappingStreaming}
									/>
								</div>
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>JSON output</Label>
									<Switch
										checked={jsonOutput}
										onCheckedChange={setJsonOutput}
									/>
								</div>
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>JSON schema</Label>
									<Switch
										checked={jsonOutputSchema}
										onCheckedChange={setJsonOutputSchema}
									/>
								</div>
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>Web search</Label>
									<Switch checked={webSearch} onCheckedChange={setWebSearch} />
								</div>
								<div className="flex items-center justify-between rounded-lg border p-3">
									<Label>Reasoning max tokens</Label>
									<Switch
										checked={reasoningMaxTokens}
										onCheckedChange={setReasoningMaxTokens}
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Additional fields (JSON, optional)</Label>
								<Textarea
									className="min-h-24 font-mono text-xs"
									value={advancedJson}
									onChange={(event) => setAdvancedJson(event.target.value)}
									placeholder='{"pricingTiers": [...], "supportedParameters": [...]}'
								/>
								<p className="text-xs text-muted-foreground">
									Merged into the create operation for fields without a form
									control (pricing tiers, tier multipliers, per-second prices,
									remaining price units, supported parameters).
								</p>
							</div>
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
