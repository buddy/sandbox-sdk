import { prettifyError, ZodError } from "zod";
import { HttpError } from "@/core/http-client";

// Only 3 error codes - use statusCode for HTTP granularity
export const ERROR_CODES = {
	/** HTTP errors - use statusCode field to distinguish (401, 403, 404, 500, etc.) */
	HTTP_ERROR: "HTTP_ERROR",

	/** Zod validation errors from user input */
	VALIDATION_ERROR: "VALIDATION_ERROR",

	/** All other errors (config, streaming, internal, etc.) */
	GENERIC_ERROR: "GENERIC_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Single SDK error class
export class BuddySDKError extends Error {
	readonly code: ErrorCode;
	declare readonly statusCode?: number;
	declare readonly details?: unknown;
	declare readonly cause?: Error;

	constructor(
		message: string,
		options?: {
			code?: ErrorCode;
			statusCode?: number;
			details?: unknown;
			cause?: Error;
		},
	) {
		super(message);
		this.name = "BuddySDKError";
		this.code = options?.code ?? ERROR_CODES.GENERIC_ERROR;

		// Only define optional properties when they have values (prevents [prop]: undefined in output)
		if (options?.statusCode !== undefined) {
			Object.defineProperty(this, "statusCode", {
				value: options.statusCode,
				enumerable: false,
				writable: false,
				configurable: true,
			});
		}
		if (options?.details !== undefined) {
			Object.defineProperty(this, "details", {
				value: options.details,
				enumerable: false,
				writable: false,
				configurable: true,
			});
		}
		if (options?.cause !== undefined) {
			Object.defineProperty(this, "cause", {
				value: options.cause,
				enumerable: false,
				writable: false,
				configurable: true,
			});
		}

		Object.setPrototypeOf(this, BuddySDKError.prototype);
	}
}

// Helper to convert HttpError to BuddySDKError
function fromHttpError(operation: string, httpError: HttpError): BuddySDKError {
	const statusText = httpError.status ? ` (HTTP ${httpError.status})` : "";
	const errorDetails =
		httpError.errors && httpError.errors.length > 0
			? httpError.errors
					.map((error) =>
						typeof error === "object" && error && "message" in error
							? error.message
							: String(error),
					)
					.join(", ")
			: httpError.message;

	return new BuddySDKError(`${operation}${statusText}: ${errorDetails}`, {
		code: ERROR_CODES.HTTP_ERROR,
		statusCode: httpError.status,
		details: httpError.errors,
	});
}

// Helper to convert ZodError to BuddySDKError
function fromZodError(operation: string, zodError: ZodError): BuddySDKError {
	const prettyError = prettifyError(zodError);
	return new BuddySDKError(`${operation}:\n${prettyError}`, {
		code: ERROR_CODES.VALIDATION_ERROR,
	});
}

// Single error boundary wrapper for all public methods
export async function withErrorHandler<T>(
	operation: string,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		// Already wrapped - pass through
		if (error instanceof BuddySDKError) {
			throw error;
		}

		let sdkError: BuddySDKError;

		// HTTP errors
		if (error instanceof HttpError) {
			sdkError = fromHttpError(operation, error);
		}
		// Zod validation errors
		else if (error instanceof ZodError) {
			sdkError = fromZodError(operation, error);
		}
		// Everything else becomes GENERIC_ERROR
		else {
			sdkError = new BuddySDKError(
				error instanceof Error ? error.message : String(error),
				{
					code: ERROR_CODES.GENERIC_ERROR,
					...(error instanceof Error && { cause: error }),
				},
			);
		}

		throw sdkError;
	}
}
