import { describe, expect, it } from "vitest";

import {
	createClosedBreaker,
	recordBreakerOutcome,
	type BreakerConfig,
} from "./breaker.js";

const config: BreakerConfig = {
	minimumRequests: 5,
	consecutiveFailureThreshold: 5,
	windowSize: 20,
	failureRateThreshold: 0.5,
	baseCooldownMs: 60_000,
	maxCooldownMs: 900_000,
	successfulProbesToClose: 2,
};

describe("recordBreakerOutcome", () => {
	it("opens after five consecutive upstream failures", () => {
		let state = createClosedBreaker();
		for (let index = 0; index < 5; index += 1) {
			state = recordBreakerOutcome(
				state,
				{ kind: "upstream_failure", at: index * 1000 },
				config,
			);
		}

		expect(state.state).toBe("open");
		expect(state.retryAt).toBe(64_000);
	});

	it("does not count customer errors as provider failures", () => {
		let state = createClosedBreaker();
		for (let index = 0; index < 10; index += 1) {
			state = recordBreakerOutcome(
				state,
				{ kind: "customer_error", at: index * 1000 },
				config,
			);
		}

		expect(state.state).toBe("closed");
		expect(state.window).toEqual([]);
	});

	it("moves to half-open after cooldown and closes after two probes", () => {
		const open = {
			...createClosedBreaker(),
			state: "open" as const,
			openedAt: 0,
			retryAt: 60_000,
			openCount: 1,
		};
		const halfOpen = recordBreakerOutcome(
			open,
			{ kind: "probe_success", at: 60_000 },
			config,
		);
		const closed = recordBreakerOutcome(
			halfOpen,
			{ kind: "probe_success", at: 61_000 },
			config,
		);

		expect(halfOpen.state).toBe("half_open");
		expect(closed.state).toBe("closed");
	});
});
