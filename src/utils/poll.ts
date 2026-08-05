export const DEFAULT_INITIAL_INTERVAL_MS = 100;
export const DEFAULT_MAX_INTERVAL_MS = 1000;
export const DEFAULT_BACKOFF_FACTOR = 1.5;

/** Configuration for a backing-off polling loop */
export interface PollOptions {
	/** Delay before the first re-check (default: 100ms) */
	initialIntervalMs?: number;
	/** Upper bound the delay grows to (default: 1000ms) */
	maxIntervalMs?: number;
	/** Multiplier applied to the delay after each poll (default: 1.5) */
	factor?: number;
	/** Maximum total time to wait; omit for an unbounded wait */
	maxWaitMs?: number;
	/** Builds the error thrown once `maxWaitMs` is exceeded */
	onTimeout?: () => Error;
}

/**
 * Turn a caller-supplied `pollIntervalMs` into poll options: omitted opts into
 * backoff, an explicit number keeps a fixed interval of exactly that length.
 */
export function resolvePollInterval(
	pollIntervalMs: number | undefined,
	maxIntervalMs: number = DEFAULT_MAX_INTERVAL_MS,
): Pick<PollOptions, "initialIntervalMs" | "maxIntervalMs"> {
	if (pollIntervalMs === undefined) {
		return { initialIntervalMs: DEFAULT_INITIAL_INTERVAL_MS, maxIntervalMs };
	}

	return {
		initialIntervalMs: pollIntervalMs,
		maxIntervalMs: pollIntervalMs,
	};
}

/** Suspend execution for the given number of milliseconds */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `check` until it returns true, growing the delay by `factor` after each
 * attempt up to `maxIntervalMs`.
 *
 * `check` runs before the first sleep and throws on terminal failure states,
 * so callers keep their own error messages.
 */
export async function pollUntil(
	check: () => Promise<boolean>,
	options: PollOptions = {},
): Promise<void> {
	const {
		initialIntervalMs = DEFAULT_INITIAL_INTERVAL_MS,
		maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
		factor = DEFAULT_BACKOFF_FACTOR,
		maxWaitMs,
		onTimeout,
	} = options;

	const startTime = Date.now();
	let delay = Math.min(initialIntervalMs, maxIntervalMs);

	while (true) {
		if (await check()) {
			return;
		}

		if (maxWaitMs !== undefined && Date.now() - startTime > maxWaitMs) {
			throw onTimeout?.() ?? new Error(`Timeout after ${String(maxWaitMs)}ms`);
		}

		await sleep(delay);
		delay = Math.min(delay * factor, maxIntervalMs);
	}
}
