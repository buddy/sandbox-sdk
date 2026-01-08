import { prettifyError, type z } from "zod";
import {
	CreateSandboxRequestSchema,
	CreateSandboxResponseSchema,
	ExecuteSandboxCommandRequestSchema,
	ExecuteSandboxCommandResponseSchema,
	GetSandboxCommandResponseSchema,
	GetSandboxesResponseSchema,
	GetSandboxResponseSchema,
	type ICreateSandboxRequest,
	type ICreateSandboxResponse,
	type IExecuteSandboxCommandRequest,
	type IExecuteSandboxCommandResponse,
	type IGetSandboxCommandResponse,
	type IGetSandboxesResponse,
	type IGetSandboxResponse,
	type IRestartSandboxResponse,
	type ISimplifiedSandbox,
	type IStartSandboxResponse,
	type IStopSandboxResponse,
	type ITerminateSandboxCommandResponse,
	RestartSandboxResponseSchema,
	SandboxCommandLogSchema,
	StartSandboxResponseSchema,
	StopSandboxResponseSchema,
	TerminateSandboxCommandResponseSchema,
} from "@/api/schemas";
import {
	HttpClient,
	type HttpClientConfig,
	HttpError,
	type HttpResponse,
	type RequestConfig,
} from "@/core/http-client";
import { ValidationError } from "@/errors";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

export interface BuddyApiConfig extends Omit<HttpClientConfig, "baseURL"> {
	workspace: string;
	project_name: string;
	token?: string;
	apiUrl?: string;
}

export class BuddyApiClient extends HttpClient {
	async #parseResponse<T>(
		schema: z.ZodType<T>,
		response: HttpResponse,
	): Promise<T> {
		const result = await schema.safeParseAsync(response.data);

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

	async #parseLogEntry(line: string) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new Error(
				`Failed to parse log entry as JSON: ${error instanceof Error ? error.message : String(error)}. Line: ${line}`,
			);
		}

		const result = await SandboxCommandLogSchema.safeParseAsync(parsed);

		if (!result.success) {
			throw new ValidationError(result.error);
		}

		const logEntry = result.data;
		// Convert STDOUT/STDERR to lowercase for consistency
		const stream =
			logEntry.type === "STDOUT" ? ("stdout" as const) : ("stderr" as const);

		return {
			stream,
			data: logEntry.data ? `${logEntry.data}\n` : "",
		};
	}

	async #requestWithValidation<T>({
		method,
		url,
		parameters,
		requestSchema,
		responseSchema,
		requestConfig: overriddenRequestConfig = {},
	}: {
		method: "GET" | "POST";
		url: string;
		parameters?: unknown;
		requestSchema?: z.ZodType;
		responseSchema: z.ZodType<T>;
		requestConfig?: RequestConfig;
	}): Promise<T> {
		const defaultRequestConfig: RequestConfig = {
			queryParams: { project_name: this.project_name },
		};

		const requestConfig = {
			...defaultRequestConfig,
			...overriddenRequestConfig,
		};

		let request: Promise<HttpResponse>;

		switch (method) {
			case "POST": {
				const validatedParameters =
					requestSchema && parameters
						? await requestSchema.parseAsync(parameters)
						: {};

				request = this.post(url, validatedParameters, requestConfig);
				break;
			}
			case "GET": {
				request = this.get(url, requestConfig);
				break;
			}
		}

		const response = await request;
		return (await this.#parseResponse(responseSchema, response)) as T;
	}

	readonly workspace: string;
	readonly project_name: string;

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
		this.project_name = config.project_name;
		this.setAuthToken(token);
	}

	/** Create a new sandbox */
	async createSandbox(parameters: ICreateSandboxRequest) {
		return this.#requestWithValidation<ICreateSandboxResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes`,
			parameters,
			requestSchema: CreateSandboxRequestSchema,
			responseSchema: CreateSandboxResponseSchema,
		});
	}

	/** Get a specific sandbox by its ID */
	async getSandboxById(sandboxId: string) {
		return this.#requestWithValidation<IGetSandboxResponse>({
			method: "GET",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}`,
			responseSchema: GetSandboxResponseSchema,
		});
	}

	/** Get a specific sandbox by its identifier */
	async getSandboxByIdentifier(identifier: string) {
		const sandboxes = await this.getSandboxes();
		const sandbox = sandboxes?.find((s) => s.identifier === identifier);

		if (!sandbox?.id) {
			return;
		}

		return this.getSandboxById(sandbox.id);
	}

	/** Execute a command in a sandbox */
	async executeCommand(
		sandboxId: string,
		parameters: IExecuteSandboxCommandRequest,
	) {
		return this.#requestWithValidation<IExecuteSandboxCommandResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands`,
			parameters,
			requestSchema: ExecuteSandboxCommandRequestSchema,
			responseSchema: ExecuteSandboxCommandResponseSchema,
		});
	}

	/** Get a specific command execution details */
	async getCommandDetails(sandboxId: string, commandId: string) {
		return this.#requestWithValidation<IGetSandboxCommandResponse>({
			method: "GET",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}`,
			responseSchema: GetSandboxCommandResponseSchema,
		});
	}

	/** Terminate a running command in a sandbox */
	async terminateCommand(sandboxId: string, commandId: string) {
		return this.#requestWithValidation<ITerminateSandboxCommandResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/commands/${commandId}/terminate`,
			responseSchema: TerminateSandboxCommandResponseSchema,
		});
	}

	/** Delete a sandbox by its ID */
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

	/** Get all sandboxes in the workspace for a specific project */
	async getSandboxes(): Promise<ISimplifiedSandbox[]> {
		return this.#requestWithValidation<IGetSandboxesResponse>({
			method: "GET",
			url: `/workspaces/${this.workspace}/sandboxes`,
			responseSchema: GetSandboxesResponseSchema,
		}).then((res) => res.sandboxes ?? []);
	}

	/** Start a sandbox */
	async startSandbox(sandboxId: string) {
		return this.#requestWithValidation<IStartSandboxResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/start`,
			responseSchema: StartSandboxResponseSchema,
		});
	}

	/** Stop a sandbox */
	async stopSandbox(sandboxId: string) {
		return this.#requestWithValidation<IStopSandboxResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/stop`,
			responseSchema: StopSandboxResponseSchema,
		});
	}

	/** Restart a sandbox */
	async restartSandbox(sandboxId: string) {
		return this.#requestWithValidation<IRestartSandboxResponse>({
			method: "POST",
			url: `/workspaces/${this.workspace}/sandboxes/${sandboxId}/restart`,
			responseSchema: RestartSandboxResponseSchema,
		});
	}

	/** Stream logs from a specific command execution */
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
					yield this.#parseLogEntry(line);
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

						const logEntry = await this.#parseLogEntry(line);

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
					yield this.#parseLogEntry(buffer);
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
}
