import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AAD_PREFIX = "betarouter:platform-provider:v1";
const FINGERPRINT_DOMAIN = "betarouter:platform-provider:fingerprint:v1";

export interface EncryptedPlatformProviderToken {
	encryptedToken: string;
	encryptionIv: string;
	encryptionAuthTag: string;
	encryptionKeyVersion: string;
}

export interface PlatformProviderCryptoConfig {
	currentVersion: string;
	encryptionKeys: Map<string, Buffer>;
	fingerprintKey: Buffer;
}

export function isPlatformProviderCryptoConfigured(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return Boolean(
		env.PLATFORM_PROVIDER_ENCRYPTION_KEYS?.trim() &&
			env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION?.trim() &&
			env.PLATFORM_PROVIDER_FINGERPRINT_KEY?.trim(),
	);
}

function decodeKey(value: string, label: string): Buffer {
	const key = Buffer.from(value, "base64");
	if (key.length !== KEY_BYTES) {
		throw new Error(`${label} must decode to exactly ${KEY_BYTES} bytes`);
	}
	return key;
}

export function loadPlatformProviderCryptoConfig(
	env: NodeJS.ProcessEnv = process.env,
): PlatformProviderCryptoConfig {
	const rawKeyRing = env.PLATFORM_PROVIDER_ENCRYPTION_KEYS?.trim();
	const currentVersion =
		env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION?.trim();
	const rawFingerprintKey = env.PLATFORM_PROVIDER_FINGERPRINT_KEY?.trim();

	if (!rawKeyRing || !currentVersion || !rawFingerprintKey) {
		throw new Error("Platform provider encryption is not configured");
	}

	const encryptionKeys = new Map<string, Buffer>();
	for (const entry of rawKeyRing.split(",")) {
		const separator = entry.indexOf(":");
		if (separator <= 0) {
			throw new Error("Invalid platform provider encryption key ring");
		}
		const version = entry.slice(0, separator).trim();
		const encodedKey = entry.slice(separator + 1).trim();
		if (!version || !encodedKey || encryptionKeys.has(version)) {
			throw new Error("Invalid platform provider encryption key ring");
		}
		encryptionKeys.set(
			version,
			decodeKey(encodedKey, `Platform provider encryption key ${version}`),
		);
	}

	if (!encryptionKeys.has(currentVersion)) {
		throw new Error(
			"Current platform provider encryption key version is unavailable",
		);
	}

	return {
		currentVersion,
		encryptionKeys,
		fingerprintKey: decodeKey(
			rawFingerprintKey,
			"Platform provider fingerprint key",
		),
	};
}

function buildAdditionalAuthenticatedData(
	credentialId: string,
	provider: string,
): Buffer {
	return Buffer.from(`${AAD_PREFIX}:${credentialId}:${provider}`, "utf8");
}

export function encryptPlatformProviderToken(
	token: string,
	credentialId: string,
	provider: string,
	config = loadPlatformProviderCryptoConfig(),
): EncryptedPlatformProviderToken {
	const key = config.encryptionKeys.get(config.currentVersion);
	if (!key) {
		throw new Error("Current platform provider encryption key is unavailable");
	}

	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	cipher.setAAD(buildAdditionalAuthenticatedData(credentialId, provider));
	const encrypted = Buffer.concat([
		cipher.update(token, "utf8"),
		cipher.final(),
	]);

	return {
		encryptedToken: encrypted.toString("base64"),
		encryptionIv: iv.toString("base64"),
		encryptionAuthTag: cipher.getAuthTag().toString("base64"),
		encryptionKeyVersion: config.currentVersion,
	};
}

export function decryptPlatformProviderToken(
	envelope: EncryptedPlatformProviderToken,
	credentialId: string,
	provider: string,
	config = loadPlatformProviderCryptoConfig(),
): string {
	const key = config.encryptionKeys.get(envelope.encryptionKeyVersion);
	if (!key) {
		throw new Error("Platform provider encryption key version is unavailable");
	}

	const decipher = createDecipheriv(
		ALGORITHM,
		key,
		Buffer.from(envelope.encryptionIv, "base64"),
	);
	decipher.setAAD(buildAdditionalAuthenticatedData(credentialId, provider));
	decipher.setAuthTag(Buffer.from(envelope.encryptionAuthTag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(envelope.encryptedToken, "base64")),
		decipher.final(),
	]).toString("utf8");
}

export function fingerprintPlatformProviderToken(
	token: string,
	config = loadPlatformProviderCryptoConfig(),
): string {
	return createHmac("sha256", config.fingerprintKey)
		.update(FINGERPRINT_DOMAIN)
		.update("\0")
		.update(token)
		.digest("hex");
}

export function maskPlatformProviderToken(token: string): string {
	if (token.length <= 8) {
		return "••••••••";
	}
	return `${token.slice(0, 4)}••••••${token.slice(-4)}`;
}
