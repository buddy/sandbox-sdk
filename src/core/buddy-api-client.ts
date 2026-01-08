import { prettifyError, ZodError, type z } from "zod";
import {
	AddSandboxRequestSchema,
	ExecuteSandboxCommandRequestSchema,
	ExecuteSandboxCommandResponseSchema,
	GetSandboxesResponseSchema,
	GetSandboxResponseSchema,
	type IAddSandboxRequest,
	type IExecuteSandboxCommandRequest,
	SandboxCommandLogSchema,
} from "@/api/schemas";
import {
	HttpClient,
	type HttpClientConfig,
	HttpError,
	type HttpResponse,
} from "@/core/http-client";
import { ValidationError } from "@/errors";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

export interface BuddyApiConfig extends Omit<HttpClientConfig, "baseURL"> {
	workspace: string;
	token?: string;
	apiUrl?: string;
}

function validateInput<T>(schema: z.ZodType<T>, data: unknown): T {
	try {
		return schema.parse(data);
	} catch (error) {
		if (error instanceof ZodError) {
			throw new ValidationError(error);
		}
		throw error;
	}
}

function parseResponse<T>(schema: z.ZodType<T>, response: HttpResponse): T {
	const result = schema.safeParse(response.data);

	if (!result.success) {
		const prettyError = prettifyError(result.error);
		throw new HttpError(
			`Response validation failed:\n${prettyError}`,
			response.status,
			response,
		);
	}

	return result.data;
}

function parseLogEntry(line: string): {
	stream: "stdout" | "stderr";
	data: string;
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		throw new Error(
			`Failed to parse log entry as JSON: ${error instanceof Error ? error.message : String(error)}. Line: ${line}`,
		);
	}

	const result = SandboxCommandLogSchema.safeParse(parsed);

	if (!result.success) {
		throw new ValidationError(result.error);
	}

	const logEntry = result.data;
	// Convert STDOUT/STDERR to lowercase for consistency
	const stream = logEntry.type === "STDOUT" ? "stdout" : "stderr";

	return {
		stream,
		data: logEntry.data ? `${logEntry.data}\n` : "",
	};
}

export class BuddyApiClient extends HttpClient {
	public readonly workspace: string;

	constructor(config: BuddyApiConfig) {
		const token = config.token ?? environment.BUDDY_TOKEN;

		if (!token) {
			throw new Error(
				"Buddy API token is required. Set BUDDY_TOKEN environment variable or pass token in config.",
			);
		}

		super({
			...config,
			baseURL: config.apiUrl ?? "https://api.buddy.works",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...config.headers,
			},
		});

		this.workspace = config.workspace;
		this.setAuthToken(token);
	}

	async createSandbox(projectName: string, parameters: IAddSandboxRequest) {
		const url = `/workspaces/${this.workspace}/sandboxes`;

		const validatedParameters = AddSandboxRequestSchema.parse(parameters);

		const response = await this.post(url, validatedParameters, {
			queryParams: { project_name: projectName },
		});
		return parseResponse(GetSandboxResponseSchema, response);
	}

	async getSandbox(sandboxId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}`;

		const response = await this.get(url);
		return parseResponse(GetSandboxResponseSchema, response);
	}

	async getSandboxByIdentifier(projectName: string, identifier: string) {
		const sandboxes = await this.listSandboxes(projectName);
		const sandbox = sandboxes?.find((s) => s.identifier === identifier);

		if (!sandbox?.id) {
			return;
		}

		return this.getSandbox(sandbox.id);
	}

	async executeCommand(
		sandboxId: string,
		command: IExecuteSandboxCommandRequest,
	) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands`;

		const validatedCommand = validateInput(
			ExecuteSandboxCommandRequestSchema,
			command,
		);
		const response = await this.post(url, validatedCommand);
		return parseResponse(ExecuteSandboxCommandResponseSchema, response);
	}

	async getCommand(sandboxId: string, commandId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}`;

		const response = await this.get(url);
		return parseResponse(ExecuteSandboxCommandResponseSchema, response);
	}

	async getCommandLogs(sandboxId: string, commandId: string): Promise<string> {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}/logs`;

		// The backend returns application/jsonl format
		const response = await this.get(url, {
			headers: {
				Accept: "application/jsonl",
			},
			responseType: "text",
		});

		return response.data as string;
	}

	async *streamCommandLogs(
		sandboxId: string,
		commandId: string,
	): AsyncGenerator<
		{ stream: "stdout" | "stderr"; data: string },
		void,
		unknown
	> {
		try {
			const apiUrl = environment.BUDDY_API_URL ?? "https://api.buddy.works";
			const token = environment.BUDDY_TOKEN;
			if (!token) {
				throw new Error("Buddy API token is required for streaming logs");
			}

			const url = `${apiUrl}/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}/logs`;

			const headers = {
				Accept: "application/jsonl",
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			};

			// Use fetch for streaming support
			const response = await fetch(url, {
				method: "GET",
				headers,
			});

			if (this.debugMode) {
				logger.debug("[HTTP REQUEST - Streaming]", {
					method: "GET",
					url,
					headers: {
						...headers,
						Authorization: headers["Authorization"] ? "***" : undefined,
					},
				});
			}

			if (!response.ok) {
				throw new Error(
					`Failed to stream logs: ${String(response.status)} ${response.statusText}`,
				);
			}

			const contentType = response.headers.get("content-type");
			if (!contentType?.includes("application/jsonl")) {
				// Fallback: if not JSONL, read as text and parse
				const text = await response.text();
				if (this.debugMode) {
					logger.debug("[HTTP RESPONSE - Non-streaming]", {
						status: response.status,
						contentType,
						body: text,
					});
				}

				// Parse as before for backwards compatibility
				const lines = text.split("\n").filter((line) => line.trim());
				for (const line of lines) {
					yield parseLogEntry(line);
				}
				return;
			}

			// Stream the response body
			if (!response.body) {
				throw new Error("No response body available for streaming");
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const result = await reader.read();
					if (result.done) break;

					// Decode the chunk and add to buffer
					const chunk = result.value as Uint8Array;
					buffer += decoder.decode(chunk, { stream: true });

					// Process complete lines
					const lines = buffer.split("\n");
					buffer = lines.pop() || ""; // Keep incomplete line in buffer

					for (const line of lines) {
						if (!line.trim()) continue;

						const logEntry = parseLogEntry(line);

						if (this.debugMode) {
							logger.debug(`[STREAM] ${logEntry.stream}`, {
								content: logEntry.data,
							});
						}

						yield logEntry;
					}
				}

				// Process any remaining data in buffer
				if (buffer.trim()) {
					yield parseLogEntry(buffer);
				}
			} finally {
				reader.releaseLock();
			}
		} catch (error) {
			if (this.debugMode) {
				logger.debug("Log streaming error", error);
			}
			throw error;
		}
	}

	async terminateCommand(sandboxId: string, commandId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}/terminate`;

		const response = await this.post(url);
		return parseResponse(ExecuteSandboxCommandResponseSchema, response);
	}

	async deleteSandbox(sandboxId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}`;

		try {
			await this.delete(url, {
				skipRetry: true, // Don't retry delete operations
			});
		} catch (error) {
			// Ignore 404 errors - sandbox already deleted
			if (
				error instanceof Error &&
				"status" in error &&
				(error as { status: number }).status !== 404
			) {
				throw error;
			}
		}
	}

	async listSandboxes(projectName: string) {
		const url = `/workspaces/${this.workspace}/sandboxes`;

		const response = await this.get(url, {
			queryParams: { project_name: projectName },
		});
		return parseResponse(GetSandboxesResponseSchema, response).sandboxes;
	}

	async startSandbox(sandboxId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/start`;

		const response = await this.post(url);
		return parseResponse(GetSandboxResponseSchema, response);
	}

	async stopSandbox(sandboxId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/stop`;

		const response = await this.post(url);
		return parseResponse(GetSandboxResponseSchema, response);
	}

	async restartSandbox(sandboxId: string) {
		const url = `/workspaces/${this.workspace}/sandboxes/${sandboxId}/restart`;

		const response = await this.post(url);
		return parseResponse(GetSandboxResponseSchema, response);
	}
}
