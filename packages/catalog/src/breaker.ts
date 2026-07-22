export interface BreakerConfig {
	minimumRequests: number;
	consecutiveFailureThreshold: number;
	windowSize: number;
	failureRateThreshold: number;
	baseCooldownMs: number;
	maxCooldownMs: number;
	successfulProbesToClose: number;
}

export interface BreakerState {
	state: "closed" | "open" | "half_open";
	window: boolean[];
	consecutiveFailures: number;
	openCount: number;
	openedAt?: number;
	retryAt?: number;
	successfulProbes: number;
}

export type BreakerOutcome =
	| { kind: "success"; at: number }
	| { kind: "upstream_failure"; at: number }
	| { kind: "customer_error"; at: number }
	| { kind: "probe_success"; at: number }
	| { kind: "probe_failure"; at: number };

export function createClosedBreaker(): BreakerState {
	return {
		state: "closed",
		window: [],
		consecutiveFailures: 0,
		openCount: 0,
		successfulProbes: 0,
	};
}

function openBreaker(
	state: BreakerState,
	at: number,
	config: BreakerConfig,
): BreakerState {
	const openCount = state.openCount + 1;
	const cooldownMultiplier = 2 ** Math.max(0, openCount - 1);
	const cooldown = Math.min(
		config.baseCooldownMs * cooldownMultiplier,
		config.maxCooldownMs,
	);
	return {
		...state,
		state: "open",
		openCount,
		openedAt: at,
		retryAt: at + cooldown,
		successfulProbes: 0,
	};
}

export function recordBreakerOutcome(
	state: BreakerState,
	outcome: BreakerOutcome,
	config: BreakerConfig,
): BreakerState {
	if (outcome.kind === "customer_error") {
		return state;
	}

	if (state.state === "open") {
		if (outcome.at < (state.retryAt ?? Number.POSITIVE_INFINITY)) {
			return state;
		}
		if (
			outcome.kind === "probe_failure" ||
			outcome.kind === "upstream_failure"
		) {
			return openBreaker(state, outcome.at, config);
		}
		if (outcome.kind === "probe_success" || outcome.kind === "success") {
			return {
				...state,
				state: "half_open",
				successfulProbes: 1,
			};
		}
	}

	if (state.state === "half_open") {
		if (
			outcome.kind === "probe_failure" ||
			outcome.kind === "upstream_failure"
		) {
			return openBreaker(state, outcome.at, config);
		}
		const successfulProbes = state.successfulProbes + 1;
		if (successfulProbes >= config.successfulProbesToClose) {
			return createClosedBreaker();
		}
		return { ...state, successfulProbes };
	}

	const failed = outcome.kind === "upstream_failure";
	const window = [...state.window, failed].slice(-config.windowSize);
	const consecutiveFailures = failed ? state.consecutiveFailures + 1 : 0;
	const failureCount = window.filter(Boolean).length;
	const failureRate = window.length === 0 ? 0 : failureCount / window.length;
	const shouldOpen =
		window.length >= config.minimumRequests &&
		(consecutiveFailures >= config.consecutiveFailureThreshold ||
			failureRate >= config.failureRateThreshold);
	const next = {
		...state,
		window,
		consecutiveFailures,
	};

	return shouldOpen ? openBreaker(next, outcome.at, config) : next;
}
