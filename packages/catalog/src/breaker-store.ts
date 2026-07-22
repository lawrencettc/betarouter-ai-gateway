import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db/db";
import {
	platformAuditLog,
	platformMappingHealthSummary,
} from "@llmgateway/db/schema";
import { logger } from "@llmgateway/logger";

import type { BreakerConfig, BreakerOutcome, BreakerState } from "./breaker.js";

const BREAKER_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROBE_LEASE_MS = 30_000;

export const DEFAULT_CATALOG_BREAKER_CONFIG: BreakerConfig = {
	minimumRequests: 5,
	consecutiveFailureThreshold: 5,
	windowSize: 20,
	failureRateThreshold: 0.5,
	baseCooldownMs: 60_000,
	maxCooldownMs: 15 * 60_000,
	successfulProbesToClose: 2,
};

interface StoredBreakerState extends BreakerState {
	probeInFlight?: boolean;
	probeExpiresAt?: number;
	probeClaimed?: boolean;
}

function key(revision: number, mappingId: string): string {
	return `platform-catalog:breaker:${revision}:${mappingId}`;
}

function parseState(value: string | null): StoredBreakerState | null {
	if (!value) {
		return null;
	}
	try {
		return JSON.parse(value) as StoredBreakerState;
	} catch {
		return null;
	}
}

const RECORD_OUTCOME_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
local state = raw and cjson.decode(raw) or {
  state = "closed", window = {}, consecutiveFailures = 0,
  openCount = 0, successfulProbes = 0
}
local previous = state.state
local kind = ARGV[1]
local at = tonumber(ARGV[2])
local minimumRequests = tonumber(ARGV[3])
local consecutiveThreshold = tonumber(ARGV[4])
local windowSize = tonumber(ARGV[5])
local rateThreshold = tonumber(ARGV[6])
local baseCooldown = tonumber(ARGV[7])
local maxCooldown = tonumber(ARGV[8])
local successfulProbesToClose = tonumber(ARGV[9])
local ttl = tonumber(ARGV[10])

local function open_breaker()
  state.openCount = (state.openCount or 0) + 1
  local multiplier = math.pow(2, math.max(0, state.openCount - 1))
  local cooldown = math.min(baseCooldown * multiplier, maxCooldown)
  state.state = "open"
  state.openedAt = at
  state.retryAt = at + cooldown
  state.successfulProbes = 0
  state.probeInFlight = false
  state.probeExpiresAt = nil
end

if kind ~= "customer_error" then
  if state.state == "open" then
    if at >= (state.retryAt or 9999999999999) then
      if kind == "probe_failure" or kind == "upstream_failure" then
        open_breaker()
      elseif kind == "probe_success" or kind == "success" then
        state.state = "half_open"
        state.successfulProbes = 1
        state.probeInFlight = false
        state.probeExpiresAt = nil
      end
    end
  elseif state.state == "half_open" then
    state.probeInFlight = false
    state.probeExpiresAt = nil
    if kind == "probe_failure" or kind == "upstream_failure" then
      open_breaker()
    else
      state.successfulProbes = (state.successfulProbes or 0) + 1
      if state.successfulProbes >= successfulProbesToClose then
        state = { state = "closed", window = {}, consecutiveFailures = 0,
          openCount = 0, successfulProbes = 0 }
      end
    end
  else
    local failed = kind == "upstream_failure"
    table.insert(state.window, failed)
    while #state.window > windowSize do table.remove(state.window, 1) end
    state.consecutiveFailures = failed and ((state.consecutiveFailures or 0) + 1) or 0
    local failures = 0
    for _, item in ipairs(state.window) do if item then failures = failures + 1 end end
    local rate = #state.window == 0 and 0 or failures / #state.window
    if #state.window >= minimumRequests and
      (state.consecutiveFailures >= consecutiveThreshold or rate >= rateThreshold) then
      open_breaker()
    end
  end
end

local encoded = cjson.encode(state)
redis.call("SET", KEYS[1], encoded, "EX", ttl)
return cjson.encode({ previous = previous, current = state.state, state = state })
`;

const CLAIM_PROBE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return cjson.encode({ claimed = false }) end
local state = cjson.decode(raw)
local now = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local eligible = (state.state == "open" and now >= (state.retryAt or 9999999999999)) or
  (state.state == "half_open" and
    (not state.probeInFlight or now >= (state.probeExpiresAt or 0)))
if not eligible then
  return cjson.encode({ claimed = false, state = state })
end
state.state = "half_open"
state.probeInFlight = true
state.probeExpiresAt = now + lease
redis.call("SET", KEYS[1], cjson.encode(state), "EX", ttl)
return cjson.encode({ claimed = true, state = state })
`;

async function persistTransition(
	revision: number,
	mappingId: string,
	previous: string,
	current: string,
	state: StoredBreakerState,
): Promise<void> {
	if (previous === current || !new Set(["open", "closed"]).has(current)) {
		return;
	}
	const action =
		current === "open"
			? "platform_catalog.circuit_open"
			: "platform_catalog.circuit_close";
	await Promise.all([
		db.insert(platformAuditLog).values({
			userId: "system",
			action,
			resourceId: mappingId,
			success: true,
			metadata: { revision, previous, current, retryAt: state.retryAt },
		}),
		db.insert(platformMappingHealthSummary).values({
			mappingId,
			catalogRevision: revision,
			breakerState: current as "closed" | "open" | "half_open",
			requestCount: state.window.length,
			upstreamFailureCount: state.window.filter(Boolean).length,
			openedAt: state.openedAt ? new Date(state.openedAt) : null,
			retryAt: state.retryAt ? new Date(state.retryAt) : null,
		}),
	]);
}

export async function recordCatalogBreakerOutcome(input: {
	revision: number;
	mappingId: string;
	outcome: BreakerOutcome;
	config?: BreakerConfig;
}): Promise<StoredBreakerState> {
	const config = input.config ?? DEFAULT_CATALOG_BREAKER_CONFIG;
	const raw = await redisClient.eval(
		RECORD_OUTCOME_SCRIPT,
		1,
		key(input.revision, input.mappingId),
		input.outcome.kind,
		input.outcome.at,
		config.minimumRequests,
		config.consecutiveFailureThreshold,
		config.windowSize,
		config.failureRateThreshold,
		config.baseCooldownMs,
		config.maxCooldownMs,
		config.successfulProbesToClose,
		BREAKER_TTL_SECONDS,
	);
	const result = JSON.parse(String(raw)) as {
		previous: string;
		current: string;
		state: StoredBreakerState;
	};
	void persistTransition(
		input.revision,
		input.mappingId,
		result.previous,
		result.current,
		result.state,
	).catch((error: unknown) => {
		logger.error("Failed to persist catalog breaker transition", { error });
	});
	return result.state;
}

export async function getCatalogBreakerStates(input: {
	revision: number;
	mappingIds: string[];
	claimProbes?: boolean;
	now?: number;
}): Promise<Record<string, StoredBreakerState>> {
	if (input.mappingIds.length === 0) {
		return {};
	}
	const values = await redisClient.mget(
		input.mappingIds.map((mappingId) => key(input.revision, mappingId)),
	);
	const states: Record<string, StoredBreakerState> = {};
	for (let index = 0; index < input.mappingIds.length; index += 1) {
		const mappingId = input.mappingIds[index]!;
		const state = parseState(values[index] ?? null);
		if (!state) {
			continue;
		}
		if (
			input.claimProbes &&
			(state.state === "open" || state.state === "half_open")
		) {
			const raw = await redisClient.eval(
				CLAIM_PROBE_SCRIPT,
				1,
				key(input.revision, mappingId),
				input.now ?? Date.now(),
				PROBE_LEASE_MS,
				BREAKER_TTL_SECONDS,
			);
			const claimed = JSON.parse(String(raw)) as {
				claimed: boolean;
				state?: StoredBreakerState;
			};
			states[mappingId] = claimed.state ?? state;
			if (claimed.claimed) {
				states[mappingId] = {
					...states[mappingId],
					probeInFlight: true,
					probeClaimed: true,
				};
			}
			continue;
		}
		states[mappingId] = state;
	}
	return states;
}

export async function resetCatalogBreaker(
	revision: number,
	mappingId: string,
): Promise<void> {
	await redisClient.del(key(revision, mappingId));
}
