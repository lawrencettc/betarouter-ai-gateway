import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformAdminMiddleware } from "@/middleware/admin.js";

import { validateProviderKey } from "@betarouter/actions";
import { redisClient } from "@betarouter/cache";
import {
	and,
	cdb,
	db,
	decryptPlatformProviderToken,
	encryptPlatformProviderToken,
	eq,
	fingerprintPlatformProviderToken,
	maskPlatformProviderToken,
	ne,
	platformAuditLog,
	platformProviderCredential,
	shortid,
} from "@betarouter/db";
import { isStealthProvider, providers } from "@betarouter/models";
import { assertSafeProviderUrl } from "@betarouter/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
import type {
	PlatformAuditLogAction,
	ProviderKeyOptions,
} from "@betarouter/db";
import type { ProviderId } from "@betarouter/models";

const platformProviders = new OpenAPIHono<ServerTypes>();
platformProviders.use("/*", platformAdminMiddleware);

const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";
const PLATFORM_PROVIDER_LIST_LIMIT = 500;
const PLATFORM_PROVIDER_REVEAL_LIMIT = 5;
const PLATFORM_PROVIDER_REVEAL_GLOBAL_LIMIT = 10;
const PLATFORM_PROVIDER_REVEAL_WINDOW_SECONDS = 60;
const PLATFORM_PROVIDER_REVEAL_MAX_SESSION_AGE_MS = 15 * 60 * 1000;
const optionsSchema = z.record(z.string(), z.string());
const statusSchema = z.enum(["active", "inactive"]);
const errorResponseSchema = z.object({ message: z.string() });

function errorResponse(description: string) {
	return {
		content: { "application/json": { schema: errorResponseSchema } },
		description,
	};
}

const credentialResponseSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	provider: z.string(),
	name: z.string(),
	baseUrl: z.string().nullable(),
	options: z.record(z.string(), z.unknown()).nullable(),
	priority: z.number(),
	status: z.enum(["active", "inactive", "deleted"]),
	maskedToken: z.string(),
	validationStatus: z.enum(["pending", "valid", "invalid", "error"]),
	validationMessage: z.string().nullable(),
	lastValidatedAt: z.date().nullable(),
	lastUsedAt: z.date().nullable(),
	lastRevealedAt: z.date().nullable(),
});

const createCredentialSchema = z.object({
	provider: z.string().min(1),
	name: z.string().trim().min(1).max(80),
	token: z.string().min(1).max(32_000),
	baseUrl: z.string().url().optional(),
	options: optionsSchema.optional(),
	priority: z.number().int().min(0).max(10_000).default(100),
	status: statusSchema.default("active"),
});

const updateCredentialSchema = z
	.object({
		name: z.string().trim().min(1).max(80).optional(),
		token: z.string().min(1).max(32_000).optional(),
		baseUrl: z.string().url().nullable().optional(),
		options: optionsSchema.nullable().optional(),
		priority: z.number().int().min(0).max(10_000).optional(),
		status: statusSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, "No changes provided");

function sanitizeValidationMessage(statusCode?: number, valid = false): string {
	if (valid) {
		return "Credential validated successfully";
	}
	return statusCode
		? `Upstream credential validation failed (status ${statusCode})`
		: "Upstream credential validation failed";
}

function assertSupportedProvider(
	provider: string,
): asserts provider is ProviderId {
	const definition = providers.find((item) => item.id === provider);
	if (
		!definition ||
		provider === "llmgateway" ||
		provider === "custom" ||
		isStealthProvider(definition)
	) {
		throw new HTTPException(400, {
			message: "This provider cannot be configured as a platform provider",
		});
	}
}

async function validateCredential(input: {
	provider: ProviderId;
	token: string;
	baseUrl?: string;
	options?: ProviderKeyOptions;
}) {
	if (
		input.provider === "vertex-anthropic" ||
		input.provider === "vertex-openai"
	) {
		let serviceAccount: unknown;
		try {
			serviceAccount = JSON.parse(input.token);
		} catch {
			throw new HTTPException(400, {
				message: "Google service account credential must be valid JSON",
			});
		}
		if (
			typeof serviceAccount !== "object" ||
			serviceAccount === null ||
			!("token_uri" in serviceAccount) ||
			serviceAccount.token_uri !== GOOGLE_OAUTH_TOKEN_URI
		) {
			throw new HTTPException(400, {
				message: "Google service account token endpoint is not allowed",
			});
		}
	}
	if (input.baseUrl) {
		await assertSafeProviderUrl(input.baseUrl);
	}
	const result = await validateProviderKey(
		input.provider,
		input.token,
		input.baseUrl,
		process.env.NODE_ENV === "test",
		input.options,
	);
	return {
		valid: result.valid && !result.error,
		message: sanitizeValidationMessage(
			result.statusCode,
			result.valid && !result.error,
		),
	};
}

function requestMetadata(c: {
	req: { header: (name: string) => string | undefined };
}) {
	return {
		requestId: c.req.header("x-request-id"),
		ipAddress:
			c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for"),
		userAgent: c.req.header("user-agent"),
	};
}

async function writePlatformAudit(
	c: Parameters<typeof requestMetadata>[0],
	input: {
		userId: string;
		action: PlatformAuditLogAction;
		resourceId?: string;
		success: boolean;
		metadata?: Record<string, unknown>;
	},
) {
	await db.insert(platformAuditLog).values({
		...input,
		...requestMetadata(c),
	});
}

async function auditFailedMutation<T>(
	c: Parameters<typeof requestMetadata>[0],
	input: {
		userId: string;
		action: PlatformAuditLogAction;
		resourceId?: string;
		metadata?: Record<string, unknown>;
	},
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		try {
			await writePlatformAudit(c, {
				...input,
				success: false,
				metadata: {
					...input.metadata,
					statusCode: error instanceof HTTPException ? error.status : 500,
				},
			});
		} catch {
			// Preserve the original failure when the audit store is unavailable.
		}
		throw error;
	}
}

async function getCredential(id: string) {
	const [credential] = await db
		.select()
		.from(platformProviderCredential)
		.where(
			and(
				eq(platformProviderCredential.id, id),
				ne(platformProviderCredential.status, "deleted"),
			),
		)
		.limit(1);
	if (!credential) {
		throw new HTTPException(404, { message: "Platform provider not found" });
	}
	return credential;
}

export function toPlatformProviderCredentialResponse(
	credential: typeof platformProviderCredential.$inferSelect,
) {
	const {
		encryptedToken: _token,
		encryptionIv: _iv,
		encryptionAuthTag: _tag,
		encryptionKeyVersion: _version,
		tokenFingerprint: _fingerprint,
		createdBy: _createdBy,
		updatedBy: _updatedBy,
		lastRevealedBy: _lastRevealedBy,
		deletedAt: _deletedAt,
		...response
	} = credential;
	return response;
}

const listRoute = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ credentials: z.array(credentialResponseSchema) }),
				},
			},
			description: "Platform provider credentials, with secrets masked.",
		},
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access required."),
		500: errorResponse("Platform provider storage is unavailable."),
	},
});

platformProviders.openapi(listRoute, async (c) => {
	const credentials = await db
		.select({
			id: platformProviderCredential.id,
			createdAt: platformProviderCredential.createdAt,
			updatedAt: platformProviderCredential.updatedAt,
			provider: platformProviderCredential.provider,
			name: platformProviderCredential.name,
			baseUrl: platformProviderCredential.baseUrl,
			options: platformProviderCredential.options,
			priority: platformProviderCredential.priority,
			status: platformProviderCredential.status,
			maskedToken: platformProviderCredential.maskedToken,
			validationStatus: platformProviderCredential.validationStatus,
			validationMessage: platformProviderCredential.validationMessage,
			lastValidatedAt: platformProviderCredential.lastValidatedAt,
			lastUsedAt: platformProviderCredential.lastUsedAt,
			lastRevealedAt: platformProviderCredential.lastRevealedAt,
		})
		.from(platformProviderCredential)
		.where(ne(platformProviderCredential.status, "deleted"))
		.orderBy(
			platformProviderCredential.provider,
			platformProviderCredential.priority,
			platformProviderCredential.createdAt,
		)
		.limit(PLATFORM_PROVIDER_LIST_LIMIT);
	return c.json({ credentials }, 200);
});

const createCredentialRoute = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: { "application/json": { schema: createCredentialSchema } },
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: credentialResponseSchema } },
			description: "Platform provider created.",
		},
		400: errorResponse("Credential validation failed."),
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access required."),
		409: errorResponse("Credential or name is already configured."),
		500: errorResponse("Credential storage or encryption failed."),
	},
});

platformProviders.openapi(createCredentialRoute, async (c) => {
	const user = c.get("user")!;
	const input = c.req.valid("json");
	return await auditFailedMutation(
		c,
		{
			userId: user.id,
			action: "platform_provider.create",
			metadata: { provider: input.provider, name: input.name },
		},
		async () => {
			assertSupportedProvider(input.provider);
			const options = input.options as ProviderKeyOptions | undefined;
			const validation = await validateCredential({
				provider: input.provider,
				token: input.token,
				baseUrl: input.baseUrl,
				options,
			});
			if (!validation.valid) {
				throw new HTTPException(400, { message: validation.message });
			}

			const id = shortid();
			const fingerprint = fingerprintPlatformProviderToken(input.token);
			const [duplicate] = await db
				.select({ id: platformProviderCredential.id })
				.from(platformProviderCredential)
				.where(
					and(
						eq(platformProviderCredential.tokenFingerprint, fingerprint),
						ne(platformProviderCredential.status, "deleted"),
					),
				)
				.limit(1);
			if (duplicate) {
				throw new HTTPException(409, {
					message: "This platform credential is already configured",
				});
			}

			const encrypted = encryptPlatformProviderToken(
				input.token,
				id,
				input.provider,
			);
			const [created] = await cdb
				.insert(platformProviderCredential)
				.values({
					id,
					provider: input.provider,
					name: input.name,
					baseUrl: input.baseUrl,
					options,
					priority: input.priority,
					status: input.status,
					...encrypted,
					maskedToken: maskPlatformProviderToken(input.token),
					tokenFingerprint: fingerprint,
					validationStatus: "valid",
					validationMessage: validation.message,
					lastValidatedAt: new Date(),
					createdBy: user.id,
					updatedBy: user.id,
				})
				.returning();
			await writePlatformAudit(c, {
				userId: user.id,
				action: "platform_provider.create",
				resourceId: created.id,
				success: true,
				metadata: { provider: created.provider, name: created.name },
			});

			return c.json(toPlatformProviderCredentialResponse(created), 201);
		},
	);
});

const updateCredentialRoute = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: { "application/json": { schema: updateCredentialSchema } },
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: credentialResponseSchema } },
			description: "Platform provider updated.",
		},
		400: errorResponse("Credential validation failed."),
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access required."),
		404: errorResponse("Platform provider not found."),
		409: errorResponse("Credential or name is already configured."),
		500: errorResponse("Credential storage or encryption failed."),
	},
});

platformProviders.openapi(updateCredentialRoute, async (c) => {
	const user = c.get("user")!;
	const { id } = c.req.valid("param");
	const input = c.req.valid("json");
	const action: PlatformAuditLogAction = input.token
		? "platform_provider.rotate"
		: input.status === "active"
			? "platform_provider.activate"
			: input.status === "inactive"
				? "platform_provider.deactivate"
				: "platform_provider.update";
	return await auditFailedMutation(
		c,
		{
			userId: user.id,
			action,
			resourceId: id,
			metadata: { changed: Object.keys(input) },
		},
		async () => {
			const existing = await getCredential(id);
			const options = (
				input.options === undefined
					? (existing.options ?? undefined)
					: (input.options ?? undefined)
			) as ProviderKeyOptions | undefined;
			const baseUrl =
				input.baseUrl === undefined ? existing.baseUrl : input.baseUrl;
			const update: Partial<typeof platformProviderCredential.$inferInsert> = {
				updatedBy: user.id,
			};

			const connectionChanged =
				input.token !== undefined ||
				input.baseUrl !== undefined ||
				input.options !== undefined;
			if (connectionChanged) {
				let validationToken: string;
				try {
					validationToken =
						input.token ??
						decryptPlatformProviderToken(
							existing,
							existing.id,
							existing.provider,
						);
				} catch {
					throw new HTTPException(500, {
						message: "Platform provider encryption is unavailable",
					});
				}
				const validation = await validateCredential({
					provider: existing.provider as ProviderId,
					token: validationToken,
					baseUrl: baseUrl ?? undefined,
					options,
				});
				if (!validation.valid) {
					throw new HTTPException(400, { message: validation.message });
				}
				if (input.token !== undefined) {
					const fingerprint = fingerprintPlatformProviderToken(input.token);
					const [duplicate] = await db
						.select({ id: platformProviderCredential.id })
						.from(platformProviderCredential)
						.where(
							and(
								eq(platformProviderCredential.tokenFingerprint, fingerprint),
								ne(platformProviderCredential.id, existing.id),
								ne(platformProviderCredential.status, "deleted"),
							),
						)
						.limit(1);
					if (duplicate) {
						throw new HTTPException(409, {
							message: "This platform credential is already configured",
						});
					}
					Object.assign(
						update,
						encryptPlatformProviderToken(
							input.token,
							existing.id,
							existing.provider,
						),
						{
							maskedToken: maskPlatformProviderToken(input.token),
							tokenFingerprint: fingerprint,
						},
					);
				}
				Object.assign(update, {
					validationStatus: "valid" as const,
					validationMessage: validation.message,
					lastValidatedAt: new Date(),
				});
			}
			if (input.name !== undefined) {
				update.name = input.name;
			}
			if (input.baseUrl !== undefined) {
				update.baseUrl = input.baseUrl;
			}
			if (input.options !== undefined) {
				update.options = options ?? null;
			}
			if (input.priority !== undefined) {
				update.priority = input.priority;
			}
			if (input.status !== undefined) {
				if (
					input.status === "active" &&
					existing.validationStatus !== "valid" &&
					!input.token
				) {
					throw new HTTPException(400, {
						message: "Validate the credential before activating it",
					});
				}
				update.status = input.status;
			}

			const [updated] = await cdb
				.update(platformProviderCredential)
				.set(update)
				.where(eq(platformProviderCredential.id, existing.id))
				.returning();
			await writePlatformAudit(c, {
				userId: user.id,
				action,
				resourceId: existing.id,
				success: true,
				metadata: { provider: existing.provider, changed: Object.keys(input) },
			});

			return c.json(toPlatformProviderCredentialResponse(updated), 200);
		},
	);
});

const validateRoute = createRoute({
	method: "post",
	path: "/{id}/validate",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ valid: z.boolean(), message: z.string() }),
				},
			},
			description: "Validation result.",
		},
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access required."),
		404: errorResponse("Platform provider not found."),
		500: errorResponse("Credential validation could not be completed."),
	},
});

platformProviders.openapi(validateRoute, async (c) => {
	const user = c.get("user")!;
	const { id } = c.req.valid("param");
	const credential = await getCredential(id);
	let valid = false;
	let message = "Upstream credential validation failed";
	try {
		const token = decryptPlatformProviderToken(
			credential,
			credential.id,
			credential.provider,
		);
		const result = await validateCredential({
			provider: credential.provider as ProviderId,
			token,
			baseUrl: credential.baseUrl ?? undefined,
			options: credential.options ?? undefined,
		});
		valid = result.valid;
		message = result.message;
	} catch {
		message = "Credential validation could not be completed";
	}
	await cdb
		.update(platformProviderCredential)
		.set({
			validationStatus: valid ? "valid" : "invalid",
			validationMessage: message,
			lastValidatedAt: new Date(),
			updatedBy: user.id,
		})
		.where(eq(platformProviderCredential.id, credential.id));
	await writePlatformAudit(c, {
		userId: user.id,
		action: "platform_provider.validate",
		resourceId: credential.id,
		success: valid,
		metadata: { provider: credential.provider },
	});
	return c.json({ valid, message }, 200);
});

export async function assertRevealRateLimit(
	userId: string,
	credentialId: string,
) {
	const keys = [
		{
			key: `rate-limit:platform-provider-reveal:user:${userId}`,
			limit: PLATFORM_PROVIDER_REVEAL_GLOBAL_LIMIT,
		},
		{
			key: `rate-limit:platform-provider-reveal:credential:${userId}:${credentialId}`,
			limit: PLATFORM_PROVIDER_REVEAL_LIMIT,
		},
	];
	for (const { key, limit } of keys) {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, PLATFORM_PROVIDER_REVEAL_WINDOW_SECONDS);
		}
		if (count > limit) {
			throw new HTTPException(429, {
				message: "Too many reveal attempts. Try again in one minute.",
			});
		}
	}
}

const revealRoute = createRoute({
	method: "post",
	path: "/{id}/reveal",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ token: z.string() }) },
			},
			description:
				"Plaintext credential for a confirmed platform-admin reveal.",
		},
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access or recent sign-in required."),
		404: errorResponse("Platform provider not found."),
		429: errorResponse("Reveal rate limit exceeded."),
		500: errorResponse("Credential encryption is unavailable."),
	},
});

platformProviders.openapi(revealRoute, async (c) => {
	const user = c.get("user")!;
	const session = c.get("session")!;
	const { id } = c.req.valid("param");
	const origin = c.req.header("origin");
	const expectedOrigin = process.env.ADMIN_URL;
	if (!origin || !expectedOrigin || origin !== expectedOrigin) {
		throw new HTTPException(403, { message: "Invalid admin request origin" });
	}
	if (
		Date.now() - new Date(session.createdAt).getTime() >
		PLATFORM_PROVIDER_REVEAL_MAX_SESSION_AGE_MS
	) {
		throw new HTTPException(403, {
			message: "Sign out and sign in again before revealing a credential",
		});
	}
	await assertRevealRateLimit(user.id, id);
	const credential = await getCredential(id);
	await writePlatformAudit(c, {
		userId: user.id,
		action: "platform_provider.reveal",
		resourceId: credential.id,
		success: false,
		metadata: { provider: credential.provider, phase: "attempt" },
	});
	let token: string;
	try {
		token = decryptPlatformProviderToken(
			credential,
			credential.id,
			credential.provider,
		);
	} catch {
		throw new HTTPException(500, {
			message: "Platform provider encryption is unavailable",
		});
	}
	await cdb
		.update(platformProviderCredential)
		.set({
			lastRevealedAt: new Date(),
			lastRevealedBy: user.id,
			updatedBy: user.id,
		})
		.where(eq(platformProviderCredential.id, credential.id));
	await writePlatformAudit(c, {
		userId: user.id,
		action: "platform_provider.reveal",
		resourceId: credential.id,
		success: true,
		metadata: { provider: credential.provider, phase: "completed" },
	});
	c.header("Cache-Control", "no-store, private");
	c.header("Pragma", "no-cache");
	return c.json({ token }, 200);
});

const deleteRoute = createRoute({
	method: "delete",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.literal(true) }) },
			},
			description: "Platform provider deleted.",
		},
		401: errorResponse("Authentication required."),
		403: errorResponse("Platform admin access required."),
		404: errorResponse("Platform provider not found."),
		500: errorResponse("Credential deletion failed."),
	},
});

platformProviders.openapi(deleteRoute, async (c) => {
	const user = c.get("user")!;
	const { id } = c.req.valid("param");
	return await auditFailedMutation(
		c,
		{
			userId: user.id,
			action: "platform_provider.delete",
			resourceId: id,
		},
		async () => {
			const credential = await getCredential(id);
			await cdb
				.update(platformProviderCredential)
				.set({
					status: "deleted",
					deletedAt: new Date(),
					updatedBy: user.id,
				})
				.where(eq(platformProviderCredential.id, credential.id));
			await writePlatformAudit(c, {
				userId: user.id,
				action: "platform_provider.delete",
				resourceId: credential.id,
				success: true,
				metadata: { provider: credential.provider, name: credential.name },
			});
			return c.json({ success: true as const }, 200);
		},
	);
});

export default platformProviders;
