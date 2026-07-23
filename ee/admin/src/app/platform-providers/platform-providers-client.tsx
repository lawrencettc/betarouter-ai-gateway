"use client";

import {
	CheckCircle2,
	Copy,
	Eye,
	EyeOff,
	KeyRound,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
	XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
	DialogTrigger,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFetchClient } from "@/lib/fetch-client";

import { isStealthProvider, providers } from "@betarouter/models";

import type { paths } from "@/lib/api/v1";

type Credential =
	paths["/admin/platform-providers"]["get"]["responses"]["200"]["content"]["application/json"]["credentials"][number];

const configurableProviders = providers
	.filter(
		(provider) =>
			provider.id !== "llmgateway" &&
			provider.id !== "custom" &&
			!isStealthProvider(provider),
	)
	.map((provider) => ({ id: provider.id, name: provider.name }))
	.sort((a, b) => a.name.localeCompare(b.name));

function errorMessage(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "The request could not be completed";
}

function formatDate(value: string | null): string {
	if (!value) {
		return "Never";
	}
	return new Date(value).toLocaleString();
}

function CredentialDialog({ credential }: { credential?: Credential }) {
	const client = useFetchClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [provider, setProvider] = useState(credential?.provider ?? "openai");
	const [name, setName] = useState(credential?.name ?? "");
	const [token, setToken] = useState("");
	const [baseUrl, setBaseUrl] = useState(credential?.baseUrl ?? "");
	const [priority, setPriority] = useState(String(credential?.priority ?? 100));
	const [status, setStatus] = useState<"active" | "inactive">(
		credential?.status === "inactive" ? "inactive" : "active",
	);
	const [options, setOptions] = useState(
		credential?.options ? JSON.stringify(credential.options, null, 2) : "",
	);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		try {
			let parsedOptions: Record<string, string> | undefined;
			if (options.trim()) {
				const parsed: unknown = JSON.parse(options);
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					Array.isArray(parsed) ||
					Object.values(parsed).some((value) => typeof value !== "string")
				) {
					throw new Error(
						"Advanced options must be a JSON object of string values",
					);
				}
				parsedOptions = parsed as Record<string, string>;
			}

			if (credential) {
				const { error } = await client.PATCH("/admin/platform-providers/{id}", {
					params: { path: { id: credential.id } },
					body: {
						name,
						...(token ? { token } : {}),
						baseUrl: baseUrl || null,
						options: parsedOptions ?? null,
						priority: Number(priority),
						status,
					},
				});
				if (error) {
					throw new Error(errorMessage(error));
				}
				toast.success("Platform provider updated");
			} else {
				const { error } = await client.POST("/admin/platform-providers", {
					body: {
						provider,
						name,
						token,
						...(baseUrl ? { baseUrl } : {}),
						options: parsedOptions,
						priority: Number(priority),
						status,
					},
				});
				if (error) {
					throw new Error(errorMessage(error));
				}
				toast.success("Platform provider added");
			}
			setToken("");
			setOpen(false);
			router.refresh();
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{credential ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-11"
						aria-label="Edit credential"
					>
						<Pencil className="h-4 w-4" />
					</Button>
				) : (
					<Button>
						<Plus className="h-4 w-4" />
						Add provider
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{credential ? "Edit platform provider" : "Add platform provider"}
					</DialogTitle>
					<DialogDescription>
						The credential is validated before it is encrypted and saved.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label>Provider</Label>
						<Select
							value={provider}
							onValueChange={setProvider}
							disabled={!!credential}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{configurableProviders.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="provider-name">Name</Label>
						<Input
							id="provider-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
							placeholder="Primary OpenAI account"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="provider-token">
							API key {credential ? "(leave blank to keep current key)" : ""}
						</Label>
						<Input
							id="provider-token"
							type="password"
							value={token}
							onChange={(event) => setToken(event.target.value)}
							required={!credential}
							autoComplete="new-password"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="provider-base-url">Base URL (optional)</Label>
						<Input
							id="provider-base-url"
							type="url"
							value={baseUrl}
							onChange={(event) => setBaseUrl(event.target.value)}
							placeholder="https://api.openai.com"
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="provider-priority">Priority</Label>
							<Input
								id="provider-priority"
								type="number"
								min="0"
								max="10000"
								value={priority}
								onChange={(event) => setPriority(event.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label>Status</Label>
							<Select
								value={status}
								onValueChange={(value) =>
									setStatus(value as "active" | "inactive")
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="provider-options">Advanced options (JSON)</Label>
						<Textarea
							id="provider-options"
							value={options}
							onChange={(event) => setOptions(event.target.value)}
							placeholder={'{\n  "region": "us-east-1"\n}'}
							className="min-h-24 font-mono text-xs"
						/>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={submitting}>
							{submitting && <Loader2 className="h-4 w-4 animate-spin" />}
							{credential ? "Save changes" : "Validate and save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RevealDialog({ credential }: { credential: Credential }) {
	const client = useFetchClient();
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		if (!token) {
			return;
		}
		const timer = window.setTimeout(() => {
			setToken(null);
			setOpen(false);
		}, 60_000);
		return () => window.clearTimeout(timer);
	}, [token]);

	const reveal = async () => {
		setLoading(true);
		try {
			const { data, error } = await client.POST(
				"/admin/platform-providers/{id}/reveal",
				{ params: { path: { id: credential.id } } },
			);
			if (error) {
				throw new Error(errorMessage(error));
			}
			setToken(data.token);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setLoading(false);
		}
	};

	const close = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setToken(null);
			setVisible(true);
		}
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-11"
					aria-label="Reveal credential"
				>
					<Eye className="h-4 w-4" />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reveal {credential.name} credential?</DialogTitle>
					<DialogDescription>
						This sensitive action is audited. The value is cleared from this
						screen after 60 seconds.
					</DialogDescription>
				</DialogHeader>
				{token ? (
					<div className="space-y-3">
						<div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
							<code className="min-w-0 flex-1 break-all text-sm">
								{visible ? token : "•".repeat(Math.min(token.length, 40))}
							</code>
							<Button
								variant="ghost"
								size="icon"
								className="size-11"
								onClick={() => setVisible((value) => !value)}
								aria-label={visible ? "Hide credential" : "Show credential"}
							>
								{visible ? <EyeOff /> : <Eye />}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="size-11"
								onClick={() => {
									void navigator.clipboard.writeText(token);
									toast.success("Credential copied");
								}}
								aria-label="Copy credential"
							>
								<Copy />
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Automatically hidden in 60 seconds.
						</p>
					</div>
				) : (
					<DialogFooter>
						<Button variant="outline" onClick={() => close(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={reveal} disabled={loading}>
							{loading && <Loader2 className="h-4 w-4 animate-spin" />}
							Reveal credential
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function PlatformProvidersClient({
	initialCredentials,
}: {
	initialCredentials: Credential[];
}) {
	const client = useFetchClient();
	const router = useRouter();
	const [busyId, setBusyId] = useState<string | null>(null);
	const activeCount = useMemo(
		() => initialCredentials.filter((item) => item.status === "active").length,
		[initialCredentials],
	);

	const run = async (
		id: string,
		operation: () => Promise<{ error?: unknown }>,
		success: string,
	) => {
		setBusyId(id);
		try {
			const result = await operation();
			if (result.error) {
				throw new Error(errorMessage(result.error));
			}
			toast.success(success);
			router.refresh();
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<ShieldCheck className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Platform Providers
							</h1>
							<p className="text-base text-muted-foreground">
								Shared upstream credentials used by betarouter accounts
							</p>
						</div>
					</div>
				</div>
				<CredentialDialog />
			</header>

			<div className="grid gap-3 sm:grid-cols-3">
				<div className="rounded-lg border bg-card p-4">
					<p className="text-sm text-muted-foreground">Credentials</p>
					<p className="mt-1 text-2xl font-semibold">
						{initialCredentials.length}
					</p>
				</div>
				<div className="rounded-lg border bg-card p-4">
					<p className="text-sm text-muted-foreground">Active</p>
					<p className="mt-1 text-2xl font-semibold text-green-600">
						{activeCount}
					</p>
				</div>
				<div className="rounded-lg border bg-card p-4">
					<p className="text-sm text-muted-foreground">Storage</p>
					<p className="mt-1 text-sm font-medium">AES-256-GCM encrypted</p>
				</div>
			</div>

			<div className="overflow-x-auto rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Credential</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Validation</TableHead>
							<TableHead>Priority</TableHead>
							<TableHead>Last checked</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{initialCredentials.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="h-40 text-center">
									<KeyRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
									<p className="font-medium">
										No platform providers configured
									</p>
									<p className="mt-1 text-base text-muted-foreground">
										Add an upstream API key to serve users through betarouter.
									</p>
								</TableCell>
							</TableRow>
						) : (
							initialCredentials.map((credential) => (
								<TableRow key={credential.id}>
									<TableCell>
										<Badge variant="outline">{credential.provider}</Badge>
									</TableCell>
									<TableCell>
										<p className="font-medium">{credential.name}</p>
										<code className="text-xs text-muted-foreground">
											{credential.maskedToken}
										</code>
										{credential.baseUrl && (
											<p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">
												{credential.baseUrl}
											</p>
										)}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Switch
												checked={credential.status === "active"}
												disabled={busyId === credential.id}
												onCheckedChange={(checked) =>
													void run(
														credential.id,
														() =>
															client.PATCH("/admin/platform-providers/{id}", {
																params: { path: { id: credential.id } },
																body: {
																	status: checked ? "active" : "inactive",
																},
															}),
														checked
															? "Credential activated"
															: "Credential deactivated",
													)
												}
											/>
											<span className="text-sm capitalize">
												{credential.status}
											</span>
										</div>
									</TableCell>
									<TableCell>
										{credential.validationStatus === "valid" ? (
											<Badge className="gap-1 bg-green-600">
												<CheckCircle2 className="h-3 w-3" />
												Valid
											</Badge>
										) : (
											<Badge variant="destructive" className="gap-1">
												<XCircle className="h-3 w-3" />
												{credential.validationStatus}
											</Badge>
										)}
										{credential.validationMessage && (
											<p className="mt-1 max-w-48 text-xs text-muted-foreground">
												{credential.validationMessage}
											</p>
										)}
									</TableCell>
									<TableCell>{credential.priority}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{formatDate(credential.lastValidatedAt)}
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-1">
											{busyId === credential.id ? (
												<Loader2 className="m-2 h-4 w-4 animate-spin" />
											) : (
												<>
													<Button
														variant="ghost"
														size="icon"
														className="size-11"
														aria-label="Validate credential"
														onClick={() =>
															void run(
																credential.id,
																() =>
																	client.POST(
																		"/admin/platform-providers/{id}/validate",
																		{ params: { path: { id: credential.id } } },
																	),
																"Validation completed",
															)
														}
													>
														<RefreshCw className="h-4 w-4" />
													</Button>
													<RevealDialog credential={credential} />
													<CredentialDialog credential={credential} />
													<Button
														variant="ghost"
														size="icon"
														className="size-11 text-destructive"
														aria-label="Delete credential"
														onClick={() => {
															if (
																window.confirm(`Delete ${credential.name}?`)
															) {
																void run(
																	credential.id,
																	() =>
																		client.DELETE(
																			"/admin/platform-providers/{id}",
																			{
																				params: { path: { id: credential.id } },
																			},
																		),
																	"Credential deleted",
																);
															}
														}}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</>
											)}
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			<p className="text-base text-muted-foreground">
				Environment-variable credentials remain available as fallback when no
				active database credential exists for a provider.
			</p>
		</div>
	);
}
