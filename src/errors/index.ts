import { prettifyError, type ZodError } from "zod";
import type { HttpError } from "@/core/http-client";

export class ValidationError extends Error {
	constructor(zodError: ZodError) {
		const prettyError = prettifyError(zodError);
		super(`Validation failed:\n${prettyError}`);
		this.name = "ValidationError";
		Object.setPrototypeOf(this, ValidationError.prototype);
	}

	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return this.stack ?? `${this.name}: ${this.message}`;
	}
}

export class SandboxError extends Error {
	public override readonly cause: Error | undefined;

	constructor(message: string, cause?: Error) {
		super(message);
		this.name = "SandboxError";
		this.cause = cause;
		Object.setPrototypeOf(this, SandboxError.prototype);
	}
}

export class SandboxCreationError extends SandboxError {
	public readonly status: number | undefined;
	public readonly apiErrors: unknown[] | undefined;

	constructor(message: string, cause?: HttpError) {
		let detailedMessage = message;

		if (cause) {
			switch (cause.status) {
				case 400: {
					detailedMessage = `Failed to create sandbox: Invalid request`;
					if (cause.errors && cause.errors.length > 0) {
						detailedMessage += `\nDetails:\n${cause.errors.map((error) => `  • ${String(error)}`).join("\n")}`;
					}

					break;
				}
				case 401: {
					detailedMessage = `Failed to create sandbox: Authentication failed. Check your API token.`;

					break;
				}
				case 403: {
					detailedMessage = `Failed to create sandbox: Permission denied for workspace or project.`;

					break;
				}
				case 404: {
					detailedMessage = `Failed to create sandbox: Workspace or project not found.`;

					break;
				}
				case 500: {
					detailedMessage = `Failed to create sandbox: Server error. Please try again later.`;

					break;
				}
				default: {
					if (cause.status) {
						detailedMessage = `Failed to create sandbox: ${cause.message}`;
					}
				}
			}
		}

		super(detailedMessage, cause);
		this.name = "SandboxCreationError";
		this.status = cause?.status;
		this.apiErrors = cause?.errors;
	}
}

export class SandboxNotFoundError extends SandboxError {
	constructor(identifier: string) {
		super(`Sandbox with identifier '${identifier}' not found`);
		this.name = "SandboxNotFoundError";
	}
}

export class SandboxNotReadyError extends SandboxError {
	public readonly sandboxId: string;
	public readonly status: string;

	constructor(sandboxId: string, status: string) {
		super(`Sandbox ${sandboxId} is not ready. Current status: ${status}`);
		this.name = "SandboxNotReadyError";
		this.sandboxId = sandboxId;
		this.status = status;
		Object.setPrototypeOf(this, SandboxNotReadyError.prototype);
	}
}
