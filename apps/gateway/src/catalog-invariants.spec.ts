import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * Static source-analysis invariants protecting the local "platform catalog"
 * subsystem (`packages/catalog` + `apps/gateway/src/lib/catalog-policy.ts`)
 * against silent removal by upstream merges.
 *
 * These tests read source files from disk only — no DB, no network, no imports
 * of production modules — so they are deterministic and fast, and they keep
 * working even when the code they inspect would not import cleanly.
 *
 * Why this exists: a simulated merge of upstream showed that refactors can drop
 * our catalog hooks inside cleanly-merging regions (e.g. upstream extracting the
 * chat cancel path into a helper whose `calculateCosts` call has no
 * `pricingOverride`). Grep-level invariants catch that class of regression.
 */

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function findRepoRoot(start: string): string {
	let current = start;
	for (;;) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			throw new Error("could not locate repository root");
		}
		current = parent;
	}
}

const SKIPPED_DIRECTORIES = new Set([
	"node_modules",
	"dist",
	".turbo",
	".next",
	".conductor",
]);

function isAnalyzableSourceFile(filePath: string): boolean {
	return (
		filePath.endsWith(".ts") &&
		!filePath.endsWith(".spec.ts") &&
		!filePath.endsWith(".e2e.ts") &&
		!filePath.endsWith(".d.ts")
	);
}

function listSourceFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					walk(full);
				}
				continue;
			}
			if (entry.isFile() && isAnalyzableSourceFile(full)) {
				out.push(full);
			}
		}
	};
	walk(root);
	return out.sort();
}

function repoPath(absolutePath: string): string {
	return relative(repoRoot, absolutePath).split(sep).join("/");
}

function read(absolutePath: string): string {
	return readFileSync(absolutePath, "utf8");
}

/**
 * Roots scanned for `calculateCosts` call sites. These are the server-side
 * billing surfaces; frontends never price requests.
 */
const COST_SCAN_ROOTS = [
	"apps/gateway/src",
	"apps/worker/src",
	"apps/api/src",
].map((p) => resolve(repoRoot, p));

interface CallSite {
	file: string;
	/** 1-based line of the `calculateCosts(` token. */
	line: number;
	/** Full source text of the call, from `calculateCosts(` to its `)`. */
	text: string;
}

/**
 * Finds every `calculateCosts(...)` call (not the declaration) and returns the
 * complete argument-list text by balancing parentheses, so the assertion can
 * inspect the options object regardless of how the call is formatted or which
 * expression (ternary, assignment, ...) it sits in.
 */
function findCalculateCostsCallSites(files: string[]): CallSite[] {
	const sites: CallSite[] = [];
	const token = "calculateCosts";

	for (const file of files) {
		const source = read(file);
		let searchFrom = 0;
		for (;;) {
			const tokenIndex = source.indexOf(token, searchFrom);
			if (tokenIndex === -1) {
				break;
			}
			searchFrom = tokenIndex + token.length;

			const before = source.slice(0, tokenIndex);
			const charBefore = before.at(-1) ?? "";
			if (/[A-Za-z0-9_$.]/.test(charBefore)) {
				continue; // part of a longer identifier or a property access
			}

			let cursor = searchFrom;
			while (cursor < source.length && /\s/.test(source[cursor])) {
				cursor++;
			}
			if (source[cursor] !== "(") {
				continue; // an import, type reference or bare mention
			}
			if (/\bfunction\s+$/.test(before)) {
				continue; // the declaration in apps/gateway/src/lib/costs.ts
			}

			let depth = 0;
			let end = cursor;
			for (; end < source.length; end++) {
				const char = source[end];
				if (char === "(") {
					depth++;
				} else if (char === ")") {
					depth--;
					if (depth === 0) {
						break;
					}
				}
			}

			sites.push({
				file: repoPath(file),
				line: before.split("\n").length,
				text: source.slice(tokenIndex, end + 1),
			});
		}
	}

	return sites;
}

const costScanFiles = COST_SCAN_ROOTS.flatMap((root) => listSourceFiles(root));
const calculateCostsCallSites = findCalculateCostsCallSites(costScanFiles);

/**
 * Invariant 1 — every billed `calculateCosts(...)` call threads the catalog
 * pricing override.
 *
 * The gateway passes it as `pricingOverride: getPricingOverride()` inside the
 * trailing `options` object of `calculateCosts` (see
 * `apps/gateway/src/lib/costs.ts` → `options.pricingOverride`, resolved in
 * `apps/gateway/src/chat/chat.ts` → `getPricingOverride()`). Without it, a
 * request priced by a platform-catalog snapshot silently falls back to the
 * static `packages/models` price.
 *
 * ALLOWLIST: call sites that legitimately need no override. Empty on purpose —
 * today every non-test call site is a billed chat path. If you add an entry,
 * state WHY the site cannot be catalog-priced (e.g. a genuinely free/unbilled
 * estimation path that never reaches `insertLog`).
 */
const PRICING_OVERRIDE_ALLOWLIST: readonly { file: string; line: number }[] =
	[];

/**
 * Invariant 2 — catalog admission coverage.
 *
 * `enforceCatalogRequest` (and the mapping filters derived from its decision)
 * is what stops a request for a model the active catalog does not expose. Every
 * gateway module that bills a request must run it.
 *
 * Exact export names come from `apps/gateway/src/lib/catalog-policy.ts`.
 */
const CATALOG_ADMISSION_ENTRYPOINTS = [
	"enforceCatalogRequest",
	"filterProviderMappingsByCatalog",
	"filterAutoCandidateByCatalog",
] as const;

/**
 * Signals that a module handles billed requests: it prices a request, resolves
 * provider credentials, or writes a usage log.
 *
 * `.insert(log)` catches surfaces that bypass the shared `insertLog` helper and
 * write the `log` table directly (the realtime session/transcription billing
 * writes do this, inside a transaction with the session aggregate update).
 */
const BILLED_PATH_SIGNALS = [
	"calculateCosts(",
	"getProviderEnv(",
	"insertLog(",
	".insert(log)",
] as const;

/**
 * Signals that a file registers HTTP routes. Deliberately narrow (OpenAPI route
 * definitions and Hono app construction) rather than bare `.get(`/`.post(`:
 * discovery became module-level below, and helper modules such as `lib/` are
 * full of unrelated `.get(`/`.post(` calls on Maps and Redis clients.
 */
const ROUTE_REGISTRATION_SIGNALS = [
	"createRoute(",
	"new OpenAPIHono",
	".openapi(",
] as const;

/**
 * Modules discovered as billed but intentionally NOT calling catalog admission
 * themselves. Each entry must justify itself and, where the reason is
 * delegation, is verified below by `delegatesToChatCompletions`.
 */
const CATALOG_ADMISSION_ALLOWLIST: Record<string, string> = {
	// /v1/images/generations does not talk to providers itself: it re-enters the
	// gateway via app.request("/v1/chat/completions"), so catalog admission and
	// catalog pricing are enforced by the chat module on the inner request. It
	// only writes the outer bookkeeping log entry.
	images: "delegates to /v1/chat/completions",
};

const DELEGATION_MARKER = '"/v1/chat/completions"';

const gatewaySrc = resolve(repoRoot, "apps/gateway/src");

interface GatewayModule {
	name: string;
	files: string[];
}

function listGatewayModules(): GatewayModule[] {
	return readdirSync(gatewaySrc, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name),
		)
		.map((entry) => ({
			name: entry.name,
			files: listSourceFiles(join(gatewaySrc, entry.name)),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function containsAny(source: string, needles: readonly string[]): boolean {
	return needles.some((needle) => source.includes(needle));
}

/**
 * Discovery is MODULE-level, not file-level: a module counts as billed when
 * some file in it bills and some file in it registers a route, even when those
 * are different files. `realtime/` is exactly that shape — `preflight.ts`
 * resolves provider credentials and `billing.ts` writes the log rows, while
 * only `client-secrets-route.ts` registers HTTP routes. A file-level
 * conjunction silently missed it.
 */
function isBilledRouteModule(module: GatewayModule): boolean {
	const sources = module.files.map(read);
	return (
		sources.some((source) => containsAny(source, BILLED_PATH_SIGNALS)) &&
		sources.some((source) => containsAny(source, ROUTE_REGISTRATION_SIGNALS))
	);
}

function hasCatalogAdmission(module: GatewayModule): boolean {
	return module.files.some((file) =>
		containsAny(read(file), CATALOG_ADMISSION_ENTRYPOINTS),
	);
}

function delegatesToChatCompletions(module: GatewayModule): boolean {
	return module.files.some((file) => read(file).includes(DELEGATION_MARKER));
}

/**
 * Invariant 4 — inline-priced surfaces must take their billing mapping from the
 * catalog filter.
 *
 * These modules never call `calculateCosts`: they multiply token/duration counts
 * by the price fields of the resolved `ProviderModelMapping` directly (e.g.
 * `Number(mapping.inputPrice) * promptTokens`, or
 * `buildRealtimePriceSnapshot(mapping)`), so invariant 1 cannot see them. Their
 * equivalent of `pricingOverride` is obtaining that mapping from
 * `filterProviderMappingsByCatalog`, which returns
 * `applyCatalogCustomerPrices()`-adjusted mappings and drops
 * operator-deactivated ones. Reverting to the static `packages/models` mapping
 * would silently bill at source cost and serve retired mappings.
 */
const INLINE_PRICED_MODULES_REQUIRING_CATALOG_FILTER = [
	"embeddings",
	"ocr",
	"realtime",
	"rerank",
	"speech",
	"transcriptions",
	"videos",
] as const;

const CATALOG_MAPPING_FILTER = "filterProviderMappingsByCatalog(";

const gatewayModules = listGatewayModules();
const billedGatewayModules = gatewayModules.filter(isBilledRouteModule);

/**
 * Pinned set of gateway modules that serve billed requests. Discovery is
 * heuristic on purpose: a brand-new upstream endpoint (realtime/, rerank/,
 * transcriptions/, ...) that prices requests, resolves provider env, or logs
 * usage lands here automatically and fails this test until it is either hooked
 * up to catalog admission or consciously allowlisted above.
 *
 * TO UPDATE: only after confirming the module either calls catalog admission or
 * belongs in CATALOG_ADMISSION_ALLOWLIST with a justification.
 */
const EXPECTED_BILLED_GATEWAY_MODULES = [
	"chat",
	"embeddings",
	"images",
	"moderations",
	"ocr",
	"realtime",
	"rerank",
	"speech",
	"transcriptions",
	"videos",
] as const;

/**
 * Invariant 3 — pinned `calculateCosts` call-site census.
 *
 * TO UPDATE: run
 *   git grep -c "calculateCosts(" -- apps/gateway/src apps/worker/src apps/api/src
 * (excluding *.spec.ts / *.e2e.ts and the declaration in lib/costs.ts) and edit
 * the numbers below only after checking each new or moved call site threads
 * `pricingOverride`. A changed count is a signal to review billing, not a
 * nuisance — do not update it mechanically.
 */
const EXPECTED_CALCULATE_COSTS_CENSUS: Record<string, number> = {
	"apps/gateway/src/chat/chat.ts": 11,
};

describe("catalog invariants (static source analysis)", () => {
	test("scan actually found source files to analyze", () => {
		expect(costScanFiles.length).toBeGreaterThan(50);
		expect(calculateCostsCallSites.length).toBeGreaterThan(0);
		expect(gatewayModules.map((m) => m.name)).toContain("chat");
	});

	describe("invariant 1: pricing override coverage", () => {
		test("every calculateCosts call threads pricingOverride", () => {
			const isAllowlisted = (site: CallSite): boolean =>
				PRICING_OVERRIDE_ALLOWLIST.some(
					(entry) => entry.file === site.file && entry.line === site.line,
				);

			const missing = calculateCostsCallSites
				.filter((site) => !site.text.includes("pricingOverride"))
				.filter((site) => !isAllowlisted(site))
				.map((site) => `${site.file}:${site.line}`);

			expect(
				missing,
				[
					"calculateCosts() call site(s) without a catalog pricingOverride.",
					"Pass `pricingOverride: getPricingOverride()` in the trailing options",
					"object, or add the site to PRICING_OVERRIDE_ALLOWLIST with a reason.",
				].join(" "),
			).toEqual([]);
		});

		test("allowlisted pricing-override exemptions still exist", () => {
			for (const entry of PRICING_OVERRIDE_ALLOWLIST) {
				const found = calculateCostsCallSites.some(
					(site) => site.file === entry.file && site.line === entry.line,
				);
				expect(
					found,
					`stale PRICING_OVERRIDE_ALLOWLIST entry ${entry.file}:${entry.line}`,
				).toBe(true);
			}
		});
	});

	describe("invariant 2: catalog admission coverage", () => {
		test("discovered set of billed gateway modules is pinned", () => {
			expect(
				billedGatewayModules.map((m) => m.name),
				[
					"The set of gateway modules that serve billed requests changed.",
					"Review each added/removed module for catalog admission, then update",
					"EXPECTED_BILLED_GATEWAY_MODULES.",
				].join(" "),
			).toEqual([...EXPECTED_BILLED_GATEWAY_MODULES]);
		});

		test("every billed gateway module enforces catalog admission", () => {
			const unhooked = billedGatewayModules
				.filter((module) => !hasCatalogAdmission(module))
				.filter((module) => !(module.name in CATALOG_ADMISSION_ALLOWLIST))
				.map((module) => module.name);

			expect(
				unhooked,
				[
					"Gateway module(s) handle billed requests without calling",
					`one of: ${CATALOG_ADMISSION_ENTRYPOINTS.join(", ")}.`,
					"Hook them up in apps/gateway/src/lib/catalog-policy.ts terms, or add",
					"them to CATALOG_ADMISSION_ALLOWLIST with a justification.",
				].join(" "),
			).toEqual([]);
		});

		test("allowlisted modules are still delegating (not billing directly)", () => {
			for (const name of Object.keys(CATALOG_ADMISSION_ALLOWLIST)) {
				const module = gatewayModules.find((m) => m.name === name);
				expect(
					module,
					`stale CATALOG_ADMISSION_ALLOWLIST entry: ${name}`,
				).toBeDefined();
				if (!module) {
					continue;
				}
				expect(
					delegatesToChatCompletions(module),
					[
						`Module "${name}" is exempt from catalog admission because it`,
						"delegates to /v1/chat/completions, but that delegation is gone.",
						"It must now call catalog admission itself.",
					].join(" "),
				).toBe(true);
			}
		});

		test("chat delegation targets keep catalog enforcement upstream", () => {
			const chat = gatewayModules.find((m) => m.name === "chat");
			expect(chat).toBeDefined();
			if (!chat) {
				return;
			}
			const chatSource = chat.files.map(read).join("\n");
			expect(chatSource).toContain("enforceCatalogRequest(");
			expect(chatSource).toContain("filterProviderMappingsByCatalog(");
			expect(chatSource).toContain("filterAutoCandidateByCatalog(");
		});
	});

	describe("invariant 4: inline-priced surfaces use the catalog mapping filter", () => {
		test.each([...INLINE_PRICED_MODULES_REQUIRING_CATALOG_FILTER])(
			"%s resolves its billing mapping through filterProviderMappingsByCatalog",
			(name) => {
				const module = gatewayModules.find((m) => m.name === name);
				expect(
					module,
					`gateway module "${name}" no longer exists`,
				).toBeDefined();
				if (!module) {
					return;
				}
				const source = module.files.map(read).join("\n");
				expect(
					source.includes(CATALOG_MAPPING_FILTER),
					[
						`Module "${name}" prices requests inline from the mapping's price`,
						"fields but no longer calls filterProviderMappingsByCatalog().",
						"Without it the mapping is the static packages/models entry, so",
						"catalog customer prices are ignored and operator-deactivated",
						"mappings stay servable.",
					].join(" "),
				).toBe(true);
			},
		);
	});

	describe("invariant 3: pinned calculateCosts census", () => {
		test("file -> call-site counts match the snapshot", () => {
			const census: Record<string, number> = {};
			for (const site of calculateCostsCallSites) {
				census[site.file] = (census[site.file] ?? 0) + 1;
			}

			expect(
				census,
				[
					"The calculateCosts() call-site census changed.",
					"Verify each new/moved call site passes `pricingOverride`, then update",
					"EXPECTED_CALCULATE_COSTS_CENSUS.",
				].join(" "),
			).toEqual(EXPECTED_CALCULATE_COSTS_CENSUS);
		});

		test("the calculateCosts declaration still accepts a pricingOverride option", () => {
			const costs = resolve(repoRoot, "apps/gateway/src/lib/costs.ts");
			expect(statSync(costs).isFile()).toBe(true);
			const source = read(costs);
			expect(source).toContain("export async function calculateCosts(");
			expect(source).toContain("pricingOverride?: ProviderModelMapping;");
		});

		test("catalog-policy exposes the admission entrypoints the hooks rely on", () => {
			const policy = read(
				resolve(repoRoot, "apps/gateway/src/lib/catalog-policy.ts"),
			);
			for (const entrypoint of CATALOG_ADMISSION_ENTRYPOINTS) {
				expect(policy).toMatch(
					new RegExp(`export (async )?function ${entrypoint}\\(`),
				);
			}
		});
	});
});
