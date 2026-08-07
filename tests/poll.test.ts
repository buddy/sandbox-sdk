import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollUntil, resolvePollInterval } from "@/utils/poll";

/** Record the delay handed to every setTimeout call while keeping timers working */
function recordDelays(): number[] {
	const delays: number[] = [];
	const scheduleTimeout = globalThis.setTimeout;

	vi.spyOn(globalThis, "setTimeout").mockImplementation(((
		callback: () => void,
		ms?: number,
	) => {
		delays.push(ms ?? 0);
		return scheduleTimeout(callback, ms);
	}) as typeof setTimeout);

	return delays;
}

describe("resolvePollInterval", () => {
	it("backs off from 100ms to 1000ms when no interval is given", () => {
		expect(resolvePollInterval(undefined)).toEqual({
			initialIntervalMs: 100,
			maxIntervalMs: 1000,
		});
	});

	it("honours a custom ceiling for the backoff case", () => {
		expect(resolvePollInterval(undefined, 2000)).toEqual({
			initialIntervalMs: 100,
			maxIntervalMs: 2000,
		});
	});

	it("pins to a fixed interval when one is given explicitly", () => {
		expect(resolvePollInterval(500)).toEqual({
			initialIntervalMs: 500,
			maxIntervalMs: 500,
		});
	});

	it("lets an explicit interval exceed the default ceiling", () => {
		expect(resolvePollInterval(5000)).toEqual({
			initialIntervalMs: 5000,
			maxIntervalMs: 5000,
		});
	});
});

describe("pollUntil", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("does not sleep when the first check already succeeds", async () => {
		const delays = recordDelays();

		await pollUntil(async () => true);

		expect(delays).toEqual([]);
	});

	it("grows the delay by 1.5x up to the 1000ms ceiling", async () => {
		const delays = recordDelays();
		let calls = 0;

		const settled = pollUntil(async () => {
			calls += 1;
			return calls > 9;
		});

		await vi.runAllTimersAsync();
		await settled;

		expect(delays.map(Math.round)).toEqual([
			100, 150, 225, 338, 506, 759, 1000, 1000, 1000,
		]);
	});

	it("keeps a constant delay when an explicit interval is used", async () => {
		const delays = recordDelays();
		let calls = 0;

		const settled = pollUntil(async () => {
			calls += 1;
			return calls > 4;
		}, resolvePollInterval(500));

		await vi.runAllTimersAsync();
		await settled;

		expect(delays).toEqual([500, 500, 500, 500]);
	});

	it("clamps the first delay to maxIntervalMs", async () => {
		const delays = recordDelays();
		let calls = 0;

		const settled = pollUntil(
			async () => {
				calls += 1;
				return calls > 2;
			},
			{ initialIntervalMs: 5000, maxIntervalMs: 200 },
		);

		await vi.runAllTimersAsync();
		await settled;

		expect(delays).toEqual([200, 200]);
	});

	it("throws the onTimeout error once maxWaitMs is exceeded", async () => {
		const settled = pollUntil(async () => false, {
			initialIntervalMs: 100,
			maxIntervalMs: 100,
			maxWaitMs: 250,
			onTimeout: () => new Error("gave up waiting"),
		});

		const assertion = expect(settled).rejects.toThrow("gave up waiting");
		await vi.runAllTimersAsync();
		await assertion;
	});

	it("falls back to a generic timeout error without onTimeout", async () => {
		const settled = pollUntil(async () => false, {
			initialIntervalMs: 100,
			maxIntervalMs: 100,
			maxWaitMs: 150,
		});

		const assertion = expect(settled).rejects.toThrow("Timeout after 150ms");
		await vi.runAllTimersAsync();
		await assertion;
	});

	it("never times out when maxWaitMs is omitted", async () => {
		let calls = 0;

		const settled = pollUntil(async () => {
			calls += 1;
			return calls > 50;
		});

		await vi.runAllTimersAsync();

		await expect(settled).resolves.toBeUndefined();
		expect(calls).toBe(51);
	});

	it("propagates a throw from check without sleeping again", async () => {
		const delays = recordDelays();
		let calls = 0;

		const settled = pollUntil(async () => {
			calls += 1;
			if (calls === 3) {
				throw new Error("terminal state");
			}
			return false;
		});

		const assertion = expect(settled).rejects.toThrow("terminal state");
		await vi.runAllTimersAsync();
		await assertion;

		expect(calls).toBe(3);
		expect(delays).toEqual([100, 150]);
	});
});
