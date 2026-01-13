import { prettifyError, z } from "zod";
import {
	type AddSandboxData,
	type AddSandboxResponse,
	type DeleteSandboxData,
	type DeleteSandboxResponse,
	type ExecuteSandboxCommandData,
	type ExecuteSandboxCommandResponse,
	type GetSandboxCommandData,
	type GetSandboxCommandLogsData,
	type GetSandboxCommandResponse,
	type GetSandboxData,
	type GetSandboxesData,
	type GetSandboxesResponse,
	type GetSandboxResponse,
	type RestartSandboxData,
	type RestartSandboxResponse,
	type SandboxCommandLog,
	type StartSandboxData,
	type StartSandboxResponse,
	type StopSandboxData,
	type StopSandboxResponse,
	type TerminateSandboxCommandData,
	type TerminateSandboxCommandResponse,
	zAddSandboxData,
	zAddSandboxResponse,
	zDeleteSandboxData,
	zDeleteSandboxResponse,
	zExecuteSandboxCommandData,
	zExecuteSandboxCommandResponse,
	zGetSandboxCommandData,
	zGetSandboxCommandLogsData,
	zGetSandboxCommandResponse,
	zGetSandboxData,
	zGetSandboxesData,
	zGetSandboxesResponse,
	zGetSandboxResponse,
	zRestartSandboxData,
	zRestartSandboxResponse,
	zSandboxCommandLog,
	zStartSandboxData,
	zStartSandboxResponse,
	zStopSandboxData,
	zStopSandboxResponse,
	zTerminateSandboxCommandData,
	zTerminateSandboxCommandResponse,
} from "@/api/openapi";
import {
	HttpClient,
	type HttpClientConfig,
	HttpError,
	type HttpResponse,
	type RequestConfig,
} from "@/core/http-client";
import type { ClientData, Data, DataUrl } from "@/types";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

export interface BuddyApiConfig extends Omit<HttpClientConfig, "baseURL"> {
	workspace: string;
	project_name: string;
	token?: string;
	apiUrl: string;
}

export class BuddyApiClient extends HttpClient {
	#buildUrl<const D extends Pick<Data, "url">>(params: {
		path?: Record<string, string>;
		url: DataUrl<D>;
	}): string {
		const { path = {}, url } = params;
		return url.replace(/{(\w+)}/g, (_, key: string) => {
			const value = path[key];
			if (value === undefined) {
				throw new Error(`Missing path parameter: ${key}`);
			}
			return value;
		});
	}

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

	#schemaExpectsQuery(schema: z.ZodObject<{ query: z.ZodType }>): boolean {
		const querySchema = schema.shape.query;
		// Check if query is z.optional(z.never()) - meaning no query params expected
		if (querySchema instanceof z.ZodOptional) {
			const inner = querySchema._def.innerType;
			if (inner instanceof z.ZodNever) {
				return false;
			}
		}
		return true;
	}

	async #requestWithValidation<const D extends Data, Response>({
		method,
		url,
		data,
		dataSchema,
		responseSchema,
		skipRetry,
	}: {
		method: "GET" | "POST" | "DELETE";
		url: DataUrl<D>;
		data: ClientData<D>;
		dataSchema: z.ZodObject<{
			body: z.ZodType;
			path: z.ZodObject<Record<string, z.ZodString>>;
			query:
				| z.ZodObject<Record<string, z.ZodString | z.ZodBoolean>>
				| z.ZodOptional<z.ZodNever>;
		}>;
		responseSchema: z.ZodType<Response>;
		skipRetry?: boolean;
	}): Promise<Response> {
		// Build full data object with defaults
		// Only add query defaults if the schema expects query params
		const expectsQuery = this.#schemaExpectsQuery(
			dataSchema as z.ZodObject<{ query: z.ZodType }>,
		);

		const fullData = {
			body: data.body,
			path: {
				workspace_domain: this.workspace,
				...(data.path ?? {}),
			},
			query: expectsQuery
				? {
						project_name: this.project_name,
						...(data.query ?? {}),
					}
				: undefined,
		};

		// Validate full data
		const result = await dataSchema.safeParseAsync(fullData);
		if (!result.success) {
			throw result.error;
		}
		const validatedData = result.data;

		const parameterizedUrl = this.#buildUrl<D>({
			url,
			path: validatedData.path,
		});

		const requestConfig: RequestConfig = {
			queryParams: validatedData.query,
			skipRetry,
		};

		let request: Promise<HttpResponse>;

		switch (method) {
			case "POST": {
				request = this.post(
					parameterizedUrl,
					validatedData.body ?? {},
					requestConfig,
				);
				break;
			}
			case "GET": {
				request = this.get(parameterizedUrl, requestConfig);
				break;
			}
			case "DELETE": {
				request = this.delete(parameterizedUrl, requestConfig);
				break;
			}
		}

		const response = await request;
		return (await this.#parseResponse(responseSchema, response)) as Response;
	}

	readonly workspace: string;
	readonly project_name: string;
	readonly #apiUrl: string;
	readonly #token: string;

	constructor(config: BuddyApiConfig) {
		const token = config.token ?? environment.BUDDY_TOKEN;

		if (!token) {
			throw new Error(
				"Buddy API token is required. Set BUDDY_TOKEN environment variable or pass token in config.",
			);
		}

		super({
			...config,
			baseURL: config.apiUrl,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...config.headers,
			},
		});

		this.workspace = config.workspace;
		this.project_name = config.project_name;
		this.#apiUrl = config.apiUrl;
		this.#token = token;
		this.setAuthToken(token);
	}

	/** Create a new sandbox */
	async addSandbox<const Data extends AddSandboxData>(data: ClientData<Data>) {
		return this.#requestWithValidation<Data, AddSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes",
			dataSchema: zAddSandboxData,
			responseSchema: zAddSandboxResponse,
		});
	}

	/** Get a specific sandbox by its ID */
	async getSandboxById<const Data extends GetSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{id}",
			dataSchema: zGetSandboxData,
			responseSchema: zGetSandboxResponse,
		});
	}

	/** Execute a command in a sandbox */
	async executeCommand<const Data extends ExecuteSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, ExecuteSandboxCommandResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands",
			dataSchema: zExecuteSandboxCommandData,
			responseSchema: zExecuteSandboxCommandResponse,
		});
	}

	/** Get a specific command execution details */
	async getCommandDetails<const Data extends GetSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxCommandResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{id}",
			dataSchema: zGetSandboxCommandData,
			responseSchema: zGetSandboxCommandResponse,
		});
	}

	/** Terminate a running command in a sandbox */
	async terminateCommand<const Data extends TerminateSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, TerminateSandboxCommandResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{command_id}/terminate",
			dataSchema: zTerminateSandboxCommandData,
			responseSchema: zTerminateSandboxCommandResponse,
		});
	}

	/** Delete a sandbox by its ID */
	async deleteSandboxById<const Data extends DeleteSandboxData>(
		data: ClientData<Data>,
	) {
		try {
			return await this.#requestWithValidation<Data, DeleteSandboxResponse>({
				method: "DELETE",
				data,
				url: "/workspaces/{workspace_domain}/sandboxes/{id}",
				dataSchema: zDeleteSandboxData,
				responseSchema: zDeleteSandboxResponse,
				skipRetry: true,
			});
		} catch (error) {
			// Ignore 404 errors - sandbox already deleted
			if (error instanceof HttpError && error.status === 404) {
				return;
			}
			throw error;
		}
	}

	/** Get all sandboxes in the workspace for a specific project */
	async getSandboxes<const Data extends GetSandboxesData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxesResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes",
			dataSchema: zGetSandboxesData,
			responseSchema: zGetSandboxesResponse,
		});
	}

	/** Start a sandbox */
	async startSandbox<const Data extends StartSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StartSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/start",
			dataSchema: zStartSandboxData,
			responseSchema: zStartSandboxResponse,
		});
	}

	/** Stop a sandbox */
	async stopSandbox<const Data extends StopSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StopSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/stop",
			dataSchema: zStopSandboxData,
			responseSchema: zStopSandboxResponse,
		});
	}

	/** Restart a sandbox */
	async restartSandbox<const Data extends RestartSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, RestartSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/restart",
			dataSchema: zRestartSandboxData,
			responseSchema: zRestartSandboxResponse,
		});
	}

	/** Stream logs from a specific command execution */
	async *streamCommandLogs<const Data extends GetSandboxCommandLogsData>(
		data: ClientData<Data>,
	): AsyncGenerator<SandboxCommandLog, void, unknown> {
		// Build full data with defaults
		const fullData = {
			body: data.body,
			path: {
				workspace_domain: this.workspace,
				...(data.path ?? {}),
			},
			query: data.query,
		};

		// Validate input data
		const validationResult =
			await zGetSandboxCommandLogsData.safeParseAsync(fullData);
		if (!validationResult.success) {
			throw validationResult.error;
		}
		const validatedData = validationResult.data;

		// Build URL with path params
		const parameterizedUrl = this.#buildUrl<Data>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{command_id}/logs",
			path: validatedData.path,
		});

		// Build full URL with query params
		const url = new URL(parameterizedUrl, this.#apiUrl);
		if (validatedData.query?.follow !== undefined) {
			url.searchParams.set("follow", String(validatedData.query.follow));
		}

		const headers = {
			Accept: "application/jsonl",
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.#token}`,
		};

		// Use fetch for streaming support
		const response = await fetch(url.toString(), {
			method: "GET",
			headers,
		});

		if (this.debugMode) {
			logger.debug("[HTTP REQUEST - Streaming]", {
				method: "GET",
				url: url.toString(),
				headers: {
					...headers,
					Authorization: "***",
				},
			});
		}

		if (!response.ok) {
			throw new HttpError(
				`Failed to stream logs: ${response.statusText}`,
				response.status,
			);
		}

		const contentType = response.headers.get("content-type");
		if (!contentType?.includes("application/jsonl")) {
			throw new Error(
				`Expected application/jsonl content type, got: ${contentType ?? "none"}`,
			);
		}

		if (!response.body) {
			throw new Error("No response body available for streaming");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const readResult = await reader.read();
				if (readResult.done) break;

				// Decode the chunk and add to buffer
				const chunk = readResult.value as Uint8Array;
				buffer += decoder.decode(chunk, { stream: true });

				// Process complete lines
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (!line.trim()) continue;

					const logEntry = await this.#parseAndValidateLogEntry(line);

					if (this.debugMode) {
						logger.debug(`[STREAM] ${logEntry.type}`, {
							content: logEntry.data,
						});
					}

					yield logEntry;
				}
			}

			// Process any remaining data in buffer
			if (buffer.trim()) {
				yield this.#parseAndValidateLogEntry(buffer);
			}
		} finally {
			reader.releaseLock();
		}
	}

	async #parseAndValidateLogEntry(line: string): Promise<SandboxCommandLog> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new Error(
				`Failed to parse log entry as JSON: ${error instanceof Error ? error.message : String(error)}. Line: ${line}`,
			);
		}

		const result = await zSandboxCommandLog.safeParseAsync(parsed);
		if (!result.success) {
			throw result.error;
		}

		return result.data;
	}
}
