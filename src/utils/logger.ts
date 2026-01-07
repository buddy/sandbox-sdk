import { PACKAGE_NAME, PACKAGE_VERSION } from "@/core/const";
import environment from "@/utils/environment";

const LOG_LEVELS = {
	debug: 5,
	info: 4,
	warn: 3,
	error: 2,
	silent: 0,
} as const;

class Logger {
	#prefix: string;
	#MAX_ERROR_DEPTH = 10;
	level: number;

	constructor() {
		this.#prefix = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;
		const levelName = environment.BUDDY_LOGGER_LEVEL;
		this.level =
			(LOG_LEVELS as Record<string, number>)[levelName ?? ""] ??
			LOG_LEVELS.warn;
	}

	get prefix(): string {
		return this.#prefix;
	}

	safeStringify(object: unknown): string {
		if (object === null || object === undefined) return "";

		const cache = new Set();
		return JSON.stringify(
			object,
			(_key, value) => {
				if (typeof value === "object" && value !== null) {
					if (cache.has(value)) {
						return "[Circular chain]";
					}
					cache.add(value);
				}
				return value;
			},
			2,
		);
	}

	#safeGetProperties(error: Error): Record<string, unknown> | undefined {
		try {
			const customProperties = Object.keys(error).filter((k) => k !== "cause");
			return customProperties.length > 0
				? Object.fromEntries(
						customProperties.map((k) => [k, Reflect.get(error, k)]),
					)
				: undefined;
		} catch {
			return undefined;
		}
	}

	#formatCompactError(error: Error): string {
		let output = `${error.name}: ${error.message}`;
		const properties = this.#safeGetProperties(error);

		if (properties) {
			try {
				const propertyPairs = Object.entries(properties)
					.map(([key, value]) => `${key}: ${this.safeStringify(value)}`)
					.join(", ");
				output += ` (${propertyPairs})`;
			} catch {
				output += " (properties unavailable)";
			}
		}

		return output;
	}

	#formatFullError(error: Error, depth: number): string {
		let output = error.stack
			? `${error.stack}\n`
			: `${error.name}: ${error.message}\n`;

		const properties = this.#safeGetProperties(error);
		if (properties) {
			try {
				output += `Properties: ${this.safeStringify(properties)}\n`;
			} catch {
				output += "Properties: [unable to serialize]\n";
			}
		}

		if ("cause" in error && error.cause) {
			output += `  Caused by: ${this.#formatErrorForDebug(error.cause, true, depth + 1)}`;

			let currentCause = error.cause;
			let currentDepth = depth + 1;
			while (
				currentDepth < this.#MAX_ERROR_DEPTH &&
				typeof currentCause === "object" &&
				"cause" in currentCause &&
				currentCause.cause
			) {
				output += `\n  → ${this.#formatErrorForDebug(currentCause.cause, true, currentDepth + 1)}`;
				currentCause = currentCause.cause;
				currentDepth++;
			}
			output += "\n";
		}

		return output;
	}

	#formatErrorForDebug(error: unknown, compact = false, depth = 0): string {
		try {
			if (depth >= this.#MAX_ERROR_DEPTH) {
				return "[Max depth reached - possible circular cause chain]";
			}

			if (!(error instanceof Error)) {
				return this.safeStringify(error);
			}

			return compact
				? this.#formatCompactError(error)
				: this.#formatFullError(error, depth);
		} catch {
			return "[Logger Error: Unable to format error details]";
		}
	}

	debug(message: string, data?: unknown) {
		if (this.level >= LOG_LEVELS.debug) {
			console.debug(
				`[${this.#prefix}] DEBUG: ${message}`,
				data ? this.safeStringify(data) : "",
			);
		}
	}

	info(message: string, data?: unknown) {
		if (this.level >= LOG_LEVELS.info) {
			console.log(
				`[${this.#prefix}] INFO: ${message}`,
				data ? this.safeStringify(data) : "",
			);
		}
	}

	warn(message: string, data?: unknown) {
		if (this.level >= LOG_LEVELS.warn) {
			console.warn(
				`[${this.#prefix}] WARN: ${message}`,
				data ? this.safeStringify(data) : "",
			);
		}
	}

	error(message: string, error: unknown) {
		if (this.level >= LOG_LEVELS.error) {
			if (this.level >= LOG_LEVELS.debug) {
				// Debug mode: full error details
				const fullError = this.#formatErrorForDebug(error);
				console.error(`[${this.#prefix}] ERROR: ${message}\n${fullError}`);
			} else {
				// Normal mode: short message
				const errorMessage =
					error instanceof Error ? error.message : this.safeStringify(error);
				console.error(
					`[${this.#prefix}] ERROR: ${message}${errorMessage ? ` - ${errorMessage}` : ""}`,
				);
			}
		}
	}
}

export default new Logger();
